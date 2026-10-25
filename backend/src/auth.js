import { z } from 'zod';
import { rateLimit } from 'express-rate-limit';
import { AppError, checkPassword, digest, token } from './domain.js';
import { transaction } from './db.js';

export function authentication(db, options) {
  const cookieName = options.production ? '__Host-shopflow' : 'sf_session';
  const cookieOptions = {
    path: '/',
    httpOnly: true,
    secure: !!options.production,
    sameSite: 'lax',
  };

  async function auth(request, response, next) {
    const raw = request.cookies[cookieName];
    if (typeof raw !== 'string' || raw.length > 100) throw new AppError(401, 'Please sign in');
    const { rows } = await db.query(
      `SELECT u.id, u."businessId", u.email, u.name, u.role, s.csrf
       FROM "Session" s JOIN "User" u ON u.id = s."userId"
       WHERE s.id = $1 AND s."expiresAt" > CURRENT_TIMESTAMP AND u.active = true`,
      [digest(raw)],
    );
    if (!rows[0]) throw new AppError(401, 'Session expired; sign in again');
    request.identity = rows[0];
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(request.method) &&
      request.headers['x-csrf-token'] !== rows[0].csrf
    )
      throw new AppError(403, 'Refresh the page before trying again');
    next();
  }

  function manager(request, response, next) {
    if (!['OWNER', 'MANAGER'].includes(request.identity.role))
      throw new AppError(403, 'You do not have permission for this action');
    next();
  }

  function register(app) {
    const loginLimit = rateLimit({
      windowMs: 60000,
      limit: 5,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: { error: 'Too many requests; try again later' },
    });
    app.post('/auth/login', loginLimit, async (request, response) => {
      const data = z
        .object({
          email: z
            .email()
            .max(254)
            .transform((value) => value.toLowerCase()),
          password: z.string().min(1).max(128),
        })
        .strict()
        .parse(request.body);
      const { rows } = await db.query('SELECT * FROM "User" WHERE email = $1', [data.email]);
      const user = rows[0];
      // Hash unknown-account attempts too, reducing differences in login timing.
      const valid = await checkPassword(
        data.password,
        user?.passwordHash ?? 'scrypt:00000000000000000000000000000000:' + '00'.repeat(64),
      );
      if (!user || !valid || !user.active)
        throw new AppError(401, 'Email or password is incorrect');
      const raw = token();
      const csrf = token();
      const expiresAt = new Date(Date.now() + (options.sessionDays ?? 7) * 86400000);
      const previous =
        typeof request.cookies[cookieName] === 'string' ? digest(request.cookies[cookieName]) : '';
      await transaction(db, async (client) => {
        await client.query(
          'DELETE FROM "Session" WHERE "expiresAt" < CURRENT_TIMESTAMP OR id = $1',
          [previous],
        );
        await client.query(
          'INSERT INTO "Session" (id, "userId", csrf, "expiresAt") VALUES ($1, $2, $3, $4)',
          [digest(raw), user.id, csrf, expiresAt],
        );
      });
      response.cookie(cookieName, raw, { ...cookieOptions, expires: expiresAt });
      response.json({
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          active: user.active,
        },
        csrf,
      });
    });
    app.get('/auth/me', auth, async (request, response) => {
      const { csrf, ...user } = request.identity;
      const { rows } = await db.query('SELECT name FROM "Business" WHERE id = $1', [
        user.businessId,
      ]);
      response.json({ user, csrf, business: { name: rows[0].name } });
    });
    app.post('/auth/logout', auth, async (request, response) => {
      await db.query('DELETE FROM "Session" WHERE id = $1', [digest(request.cookies[cookieName])]);
      response.clearCookie(cookieName, cookieOptions).json({ ok: true });
    });
  }
  return { auth, manager, register };
}
