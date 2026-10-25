import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { createDb, transaction } from './db.js';
import { hashPassword } from './domain.js';

const env = z
  .object({
    DATABASE_URL: z.string().url(),
    OWNER_EMAIL: z.email().transform((value) => value.toLowerCase()),
    OWNER_NAME: z.string().trim().min(1).max(100),
    OWNER_PASSWORD: z.string().min(12).max(128),
    BUSINESS_NAME: z.string().trim().min(1).max(160),
  })
  .parse(process.env);
const db = createDb(env.DATABASE_URL);
try {
  const passwordHash = await hashPassword(env.OWNER_PASSWORD);
  await transaction(db, async (client) => {
    const existing = await client.query('SELECT id FROM "User" WHERE email = $1', [
      env.OWNER_EMAIL,
    ]);
    if (existing.rowCount) throw new Error('This email already exists; no account was changed');
    const businessId = randomUUID();
    await client.query('INSERT INTO "Business" (id, name) VALUES ($1, $2)', [
      businessId,
      env.BUSINESS_NAME,
    ]);
    await client.query(
      `INSERT INTO "User" (id, "businessId", email, name, "passwordHash", role) VALUES ($1, $2, $3, $4, $5, 'OWNER')`,
      [randomUUID(), businessId, env.OWNER_EMAIL, env.OWNER_NAME, passwordHash],
    );
  });
  console.log('Business and owner created. Sign in with the email and password you supplied.');
} finally {
  await db.end();
}
