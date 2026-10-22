import Fastify, { type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { z } from 'zod';
import type { Db } from './db.js';
import {
  AppError,
  checkPassword,
  checkoutSchema,
  csvCell,
  decimalMoney,
  digest,
  formatMoney,
  hashPassword,
  id,
  money,
  refundSchema,
  safeSum,
  token,
} from './domain.js';
import { checkout, purchaseSchema, receivePurchase, refundSale, type Actor } from './trading.js';
import { invoicePdf, makePdf } from './pdf.js';
import { photoChoice, preparePhoto } from './photos.js';
import {
  barcodeSchema,
  catalogueProduct,
  favouriteProduct,
  listProducts,
  productDetails,
  productQuery,
} from './catalogue.js';
import {
  importBody,
  importPreviewBody,
  importProducts,
  previewProductImport,
} from './product-import.js';
import { salesAnalytics } from './analytics.js';
type Identity = Actor & { email: string; name: string; csrf: string };
declare module 'fastify' {
  interface FastifyRequest {
    identity: Identity | null;
  }
}
const manager = ['OWNER', 'MANAGER'] as const;
const productBody = productDetails.extend({ photo: photoChoice.optional() }).strict();
const dateQuery = z
  .object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    format: z.enum(['json', 'csv', 'pdf']).default('json'),
    kind: z.enum(['sales', 'stock']).default('sales'),
  })
  .strict();
const pageQuery = z.object({
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  search: z.string().max(160).default(''),
});
const safeUser = (u: {
  id: string;
  email: string;
  name: string;
  role: string;
  active: boolean;
}) => ({ id: u.id, email: u.email, name: u.name, role: u.role, active: u.active });
const safeSale = <T extends { requestHash: string; lines: { costMinor: number }[] }>(sale: T) => {
  const { requestHash: _, ...rest } = sale;
  return { ...rest, lines: sale.lines.map(({ costMinor: _cost, ...line }) => line) };
};
export function buildApp(
  db: Db,
  options: { origin: string; production?: boolean; logger?: boolean; sessionDays?: number },
) {
  const app = Fastify({
    logger: options.logger
      ? { redact: ['req.headers.cookie', 'req.headers.authorization', 'req.headers.x-csrf-token'] }
      : false,
    bodyLimit: 128 * 1024,
    requestTimeout: 30_000,
  });
  const cookieName = options.production ? '__Host-shopflow' : 'sf_session';
  const cookieOptions = {
    path: '/',
    httpOnly: true,
    secure: !!options.production,
    sameSite: 'lax' as const,
  };
  app.register(cookie);
  app.register(helmet);
  app.register(rateLimit, { max: 180, timeWindow: '1 minute' });
  app.decorateRequest('identity', null);
  app.setErrorHandler((error, req, reply) => {
    if (error instanceof z.ZodError)
      return reply.code(400).send({
        error: 'Invalid input',
        details: error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      });
    if (error instanceof AppError)
      return reply.code(error.statusCode).send({ error: error.message });
    const code = (error as { code?: string }).code;
    if (code === 'P2002')
      return reply.code(409).send({ error: 'A record with that value already exists' });
    if (code === 'P2003') return reply.code(400).send({ error: 'Related record is unavailable' });
    if (code === 'P2034')
      return reply.code(409).send({ error: 'The record changed; retry the same request' });
    const status = (error as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500)
      return reply
        .code(status)
        .send({ error: status === 429 ? 'Too many requests; try again later' : 'Invalid request' });
    req.log.error({ err: error }, 'Request failed');
    return reply.code(500).send({ error: 'Request could not be completed' });
  });
  app.addHook('onRequest', async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers.origin !== options.origin)
      throw new AppError(403, 'Request origin is not allowed');
  });
  async function auth(req: FastifyRequest) {
    const raw = req.cookies[cookieName];
    if (!raw || raw.length > 100) throw new AppError(401, 'Please sign in');
    const session = await db.session.findUnique({
      where: { id: digest(raw) },
      include: { user: true },
    });
    if (!session || session.expiresAt <= new Date() || !session.user.active)
      throw new AppError(401, 'Session expired; sign in again');
    req.identity = {
      id: session.user.id,
      businessId: session.user.businessId,
      email: session.user.email,
      name: session.user.name,
      role: session.user.role,
      csrf: session.csrf,
    };
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
      req.headers['x-csrf-token'] !== session.csrf
    )
      throw new AppError(403, 'Refresh the page before trying again');
  }
  const allow = (roles: readonly string[]) => async (req: FastifyRequest) => {
    await auth(req);
    if (!roles.includes(req.identity!.role))
      throw new AppError(403, 'You do not have permission for this action');
  };
  app.get('/health', async () => {
    await db.$queryRaw`SELECT 1`;
    return { status: 'ok' };
  });
  app.post(
    '/auth/login',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const data = z
        .object({
          email: z
            .email()
            .max(254)
            .transform((v) => v.toLowerCase()),
          password: z.string().min(1).max(128),
        })
        .strict()
        .parse(req.body);
      const user = await db.user.findUnique({ where: { email: data.email } });
      // Run scrypt even for unknown accounts to reduce account enumeration through timing.
      const valid = await checkPassword(
        data.password,
        user?.passwordHash ?? 'scrypt:00000000000000000000000000000000:' + '00'.repeat(64),
      );
      if (!user || !valid || !user.active)
        throw new AppError(401, 'Email or password is incorrect');
      const raw = token();
      const csrf = token();
      const expiresAt = new Date(Date.now() + (options.sessionDays ?? 7) * 86400000);
      await db.$transaction(async (tx) => {
        await tx.session.deleteMany({
          where: {
            OR: [
              { expiresAt: { lt: new Date() } },
              ...(req.cookies[cookieName] ? [{ id: digest(req.cookies[cookieName]!) }] : []),
            ],
          },
        });
        await tx.session.create({ data: { id: digest(raw), userId: user.id, csrf, expiresAt } });
      });
      reply.setCookie(cookieName, raw, { ...cookieOptions, expires: expiresAt });
      return { user: safeUser(user), csrf };
    },
  );
  app.get('/auth/me', { preHandler: auth }, async (req) => {
    const { csrf, ...user } = req.identity!;
    const business = await db.business.findUniqueOrThrow({ where: { id: user.businessId } });
    return { user, csrf, business: { name: business.name } };
  });
  app.post('/auth/logout', { preHandler: auth }, async (req, reply) => {
    await db.session.deleteMany({ where: { id: digest(req.cookies[cookieName]!) } });
    reply.clearCookie(cookieName, cookieOptions);
    return { ok: true };
  });
  app.post(
    '/auth/password',
    { preHandler: auth, config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const body = z
        .object({
          currentPassword: z.string().min(1).max(128),
          newPassword: z.string().min(12).max(128),
        })
        .strict()
        .parse(req.body);
      const user = await db.user.findUniqueOrThrow({ where: { id: req.identity!.id } });
      if (!(await checkPassword(body.currentPassword, user.passwordHash)))
        throw new AppError(400, 'Current password is incorrect');
      const passwordHash = await hashPassword(body.newPassword);
      await db.$transaction(async (tx) => {
        await tx.user.update({ where: { id: user.id }, data: { passwordHash } });
        await tx.session.deleteMany({ where: { userId: user.id } });
        await tx.audit.create({
          data: {
            businessId: user.businessId,
            actorId: user.id,
            action: 'PASSWORD_CHANGED',
            entityId: user.id,
          },
        });
      });
      reply.clearCookie(cookieName, cookieOptions);
      return { ok: true };
    },
  );
  app.get('/users', { preHandler: allow(['OWNER']) }, async (req) =>
    db.user.findMany({
      where: { businessId: req.identity!.businessId },
      select: { id: true, email: true, name: true, role: true, active: true },
      orderBy: { name: 'asc' },
      take: 200,
    }),
  );
  app.post('/users', { preHandler: allow(['OWNER']) }, async (req) => {
    const data = z
      .object({
        name: z.string().trim().min(1).max(100),
        email: z
          .email()
          .max(254)
          .transform((v) => v.toLowerCase()),
        password: z.string().min(12).max(128),
        role: z.enum(['OWNER', 'MANAGER', 'CASHIER']),
      })
      .strict()
      .parse(req.body);
    return db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          businessId: req.identity!.businessId,
          name: data.name,
          email: data.email,
          role: data.role,
          passwordHash: await hashPassword(data.password),
        },
      });
      await tx.audit.create({
        data: {
          businessId: req.identity!.businessId,
          actorId: req.identity!.id,
          action: 'USER_CREATED',
          entityId: user.id,
        },
      });
      return safeUser(user);
    });
  });
  app.patch('/users/:id', { preHandler: allow(['OWNER']) }, async (req) => {
    const userId = id.parse((req.params as { id: string }).id);
    const data = z.object({ active: z.boolean() }).strict().parse(req.body);
    if (userId === req.identity!.id) throw new AppError(400, 'You cannot disable your own account');
    return db.$transaction(async (tx) => {
      const changed = await tx.user.updateMany({
        where: { id: userId, businessId: req.identity!.businessId, role: { not: 'OWNER' } },
        data,
      });
      if (!changed.count)
        throw new AppError(
          404,
          'Team member not found; owner accounts require administrator recovery',
        );
      await tx.session.deleteMany({ where: { userId } });
      await tx.audit.create({
        data: {
          businessId: req.identity!.businessId,
          actorId: req.identity!.id,
          action: data.active ? 'USER_ENABLED' : 'USER_DISABLED',
          entityId: userId,
        },
      });
      return { ok: true };
    });
  });
  for (const kind of ['categories', 'suppliers'] as const) {
    app.get(
      `/${kind}`,
      { preHandler: kind === 'categories' ? auth : allow(manager) },
      async (req) => {
        const where = { businessId: req.identity!.businessId };
        return kind === 'categories'
          ? db.category.findMany({ where, orderBy: { name: 'asc' }, take: 1000 })
          : db.supplier.findMany({ where, orderBy: { name: 'asc' }, take: 1000 });
      },
    );
    app.post(`/${kind}`, { preHandler: allow(manager) }, async (req) => {
      const body = (
        kind === 'categories'
          ? z.object({ name: z.string().trim().min(1).max(100) }).strict()
          : z
              .object({
                name: z.string().trim().min(1).max(100),
                contact: z.string().trim().max(200).optional(),
              })
              .strict()
      ).parse(req.body);
      const data = { ...body, businessId: req.identity!.businessId };
      return db.$transaction(async (tx) => {
        const record =
          kind === 'categories'
            ? await tx.category.create({ data })
            : await tx.supplier.create({ data });
        await tx.audit.create({
          data: {
            businessId: req.identity!.businessId,
            actorId: req.identity!.id,
            action: kind === 'categories' ? 'CATEGORY_CREATED' : 'SUPPLIER_CREATED',
            entityId: record.id,
          },
        });
        return record;
      });
    });
    app.patch(`/${kind}/:id`, { preHandler: allow(manager) }, async (req) => {
      const recordId = id.parse((req.params as { id: string }).id);
      const data = (
        kind === 'categories'
          ? z.object({ name: z.string().trim().min(1).max(100) }).strict()
          : z
              .object({
                name: z.string().trim().min(1).max(100),
                contact: z.string().trim().max(200).nullable().optional(),
              })
              .strict()
      ).parse(req.body);
      const where = { id: recordId, businessId: req.identity!.businessId };
      return db.$transaction(async (tx) => {
        const changed =
          kind === 'categories'
            ? await tx.category.updateMany({ where, data })
            : await tx.supplier.updateMany({ where, data });
        if (!changed.count) throw new AppError(404, 'Record not found');
        await tx.audit.create({
          data: {
            businessId: req.identity!.businessId,
            actorId: req.identity!.id,
            action: kind === 'categories' ? 'CATEGORY_UPDATED' : 'SUPPLIER_UPDATED',
            entityId: recordId,
          },
        });
        return { ok: true };
      });
    });
    app.delete(`/${kind}/:id`, { preHandler: allow(manager) }, async (req) => {
      const where = {
        id: id.parse((req.params as { id: string }).id),
        businessId: req.identity!.businessId,
      };
      try {
        await db.$transaction(async (tx) => {
          const changed =
            kind === 'categories'
              ? await tx.category.deleteMany({ where })
              : await tx.supplier.deleteMany({ where });
          if (!changed.count) throw new AppError(404, 'Record not found');
          await tx.audit.create({
            data: {
              businessId: req.identity!.businessId,
              actorId: req.identity!.id,
              action: kind === 'categories' ? 'CATEGORY_DELETED' : 'SUPPLIER_DELETED',
              entityId: where.id,
            },
          });
        });
      } catch (error) {
        if ((error as { code?: string }).code === 'P2003')
          throw new AppError(
            409,
            'This record is in use. Keep it to preserve inventory and purchase history.',
          );
        throw error;
      }
      return { ok: true };
    });
  }
  app.get('/products', { preHandler: auth }, async (req) => {
    return listProducts(db, req.identity!, productQuery.parse(req.query));
  });
  app.get('/products/lookup', { preHandler: auth }, async (req) => {
    const { barcode } = z.object({ barcode: barcodeSchema }).strict().parse(req.query);
    const product = await db.product.findFirst({
      where: { businessId: req.identity!.businessId, barcode, active: true },
      include: {
        category: true,
        favourites: { where: { userId: req.identity!.id }, select: { userId: true } },
      },
    });
    if (!product) throw new AppError(404, 'No active product has that barcode');
    return catalogueProduct(product, req.identity!);
  });
  app.patch('/products/:id/favourite', { preHandler: auth }, async (req) => {
    const productId = id.parse((req.params as { id: string }).id);
    const { favourite } = z.object({ favourite: z.boolean() }).strict().parse(req.body);
    return favouriteProduct(db, req.identity!, productId, favourite);
  });
  app.post(
    '/products/import/preview',
    {
      preHandler: allow(manager),
      bodyLimit: 1024 * 1024,
      config: { rateLimit: { max: 15, timeWindow: '1 minute' } },
    },
    async (req) => {
      const { csv } = importPreviewBody.parse(req.body);
      return previewProductImport(db, req.identity!.businessId, csv);
    },
  );
  app.post(
    '/products/import',
    {
      preHandler: allow(manager),
      bodyLimit: 1024 * 1024,
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req) => {
      return importProducts(db, req.identity!, importBody.parse(req.body));
    },
  );
  app.get('/analytics/sales', { preHandler: allow(manager) }, async (req) => {
    const { days } = z
      .object({ days: z.enum(['7', '30']).default('7') })
      .strict()
      .parse(req.query);
    return salesAnalytics(db, req.identity!.businessId, days === '7' ? 7 : 30);
  });
  app.get('/products/:id/photo', { preHandler: auth }, async (req, reply) => {
    const productId = id.parse((req.params as { id: string }).id);
    const photo = await db.productPhoto.findFirst({
      where: { productId, businessId: req.identity!.businessId },
    });
    if (!photo) throw new AppError(404, 'Photo not found');
    return reply
      .type('image/jpeg')
      .header('X-Content-Type-Options', 'nosniff')
      .send(Buffer.from(photo.content));
  });
  app.post('/products', { preHandler: allow(manager), bodyLimit: 768 * 1024 }, async (req) => {
    const { photo: choice, ...data } = productBody.parse(req.body);
    const photo = await preparePhoto(choice);
    const businessId = req.identity!.businessId;
    if (
      data.categoryId &&
      !(await db.category.findFirst({ where: { id: data.categoryId, businessId } }))
    )
      throw new AppError(404, 'Category not found');
    return db.$transaction(async (tx) => {
      const product = await tx.product.create({
        data: {
          ...data,
          businessId,
          ...(photo ? { photoKey: photo.photoKey, photoVersion: photo.photoVersion } : {}),
        },
      });
      if (photo?.content)
        await tx.productPhoto.create({
          data: { productId: product.id, businessId, content: photo.content },
        });
      await tx.audit.create({
        data: {
          businessId,
          actorId: req.identity!.id,
          action: 'PRODUCT_CREATED',
          entityId: product.id,
        },
      });
      return product;
    });
  });
  app.patch('/products/:id', { preHandler: allow(manager), bodyLimit: 768 * 1024 }, async (req) => {
    const productId = id.parse((req.params as { id: string }).id);
    const { photo: choice, ...data } = productBody
      .partial()
      .extend({ active: z.boolean().optional() })
      .strict()
      .parse(req.body);
    const photo = await preparePhoto(choice);
    const businessId = req.identity!.businessId;
    if (
      data.categoryId &&
      !(await db.category.findFirst({ where: { id: data.categoryId, businessId } }))
    )
      throw new AppError(404, 'Category not found');
    return db.$transaction(async (tx) => {
      const changed = await tx.product.updateMany({
        where: { id: productId, businessId },
        data: {
          ...data,
          ...(photo ? { photoKey: photo.photoKey, photoVersion: photo.photoVersion } : {}),
        },
      });
      if (!changed.count) throw new AppError(404, 'Product not found');
      if (photo?.content)
        await tx.productPhoto.upsert({
          where: { productId },
          create: { productId, businessId, content: photo.content },
          update: { content: photo.content },
        });
      else if (photo) await tx.productPhoto.deleteMany({ where: { productId, businessId } });
      await tx.audit.create({
        data: {
          businessId,
          actorId: req.identity!.id,
          action: 'PRODUCT_UPDATED',
          entityId: productId,
        },
      });
      return { ok: true };
    });
  });
  app.get('/purchases', { preHandler: allow(manager) }, async (req) =>
    db.purchase.findMany({
      where: { businessId: req.identity!.businessId },
      include: { supplier: true, lines: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    }),
  );
  app.post('/purchases', { preHandler: allow(manager) }, (req) =>
    receivePurchase(db, req.identity!, purchaseSchema.parse(req.body)),
  );
  app.get('/movements', { preHandler: allow(manager) }, async (req) => {
    const { page } = pageQuery.parse(req.query);
    return db.stockMovement.findMany({
      where: { businessId: req.identity!.businessId },
      include: { product: { select: { name: true, sku: true } } },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * 100,
      take: 100,
    });
  });
  app.post('/sales', { preHandler: auth }, async (req) =>
    safeSale(await checkout(db, req.identity!, checkoutSchema.parse(req.body))),
  );
  app.get('/sales', { preHandler: auth }, async (req) => {
    const { page } = pageQuery.parse(req.query);
    return (
      await db.sale.findMany({
        where: { businessId: req.identity!.businessId },
        include: { lines: true, refunds: true },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * 50,
        take: 50,
      })
    ).map(safeSale);
  });
  app.get('/sales/:id/invoice.pdf', { preHandler: auth }, async (req, reply) => {
    const sale = await db.sale.findFirst({
      where: {
        id: id.parse((req.params as { id: string }).id),
        businessId: req.identity!.businessId,
      },
      include: { lines: true },
    });
    if (!sale) throw new AppError(404, 'Sale not found');
    const business = await db.business.findUniqueOrThrow({
      where: { id: req.identity!.businessId },
    });
    return reply
      .type('application/pdf')
      .header('Content-Disposition', `attachment; filename="SF-${sale.invoiceNo}.pdf"`)
      .send(await invoicePdf(business.name, sale));
  });
  app.post('/sales/:id/refunds', { preHandler: allow(manager) }, (req) =>
    refundSale(
      db,
      req.identity!,
      id.parse((req.params as { id: string }).id),
      refundSchema.parse(req.body),
    ),
  );
  app.get('/dashboard', { preHandler: auth }, async (req) => {
    const businessId = req.identity!.businessId;
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Colombo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    const since = new Date(`${today}T00:00:00+05:30`);
    return db.$transaction(
      async (tx) => {
        const [sales, refunds, products, lowStock] = await Promise.all([
          tx.sale.aggregate({
            where: { businessId, createdAt: { gte: since } },
            _sum: { totalMinor: true },
            _count: true,
          }),
          tx.refund.aggregate({
            where: { businessId, createdAt: { gte: since } },
            _sum: { totalMinor: true },
          }),
          tx.product.count({ where: { businessId, active: true } }),
          tx.$queryRaw<
            {
              id: string;
              name: string;
              sku: string;
              stock: number;
              reorderLevel: number;
              photoKey: string | null;
              photoVersion: string | null;
            }[]
          >`SELECT id, name, sku, stock, "reorderLevel", "photoKey", "photoVersion" FROM "Product" WHERE "businessId" = ${businessId} AND active = true AND stock <= "reorderLevel" ORDER BY stock, name LIMIT 20`,
        ]);
        return {
          today,
          grossMinor: sales._sum.totalMinor ?? 0,
          refundMinor: refunds._sum.totalMinor ?? 0,
          netMinor: (sales._sum.totalMinor ?? 0) - (refunds._sum.totalMinor ?? 0),
          saleCount: sales._count,
          productCount: products,
          lowStock,
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  });
  app.get('/reports', { preHandler: allow(manager) }, async (req, reply) => {
    const query = dateQuery.parse(req.query);
    const businessId = req.identity!.businessId;
    const from = new Date(`${query.from}T00:00:00+05:30`);
    const lastDay = new Date(`${query.to}T00:00:00+05:30`);
    const until = new Date(lastDay.getTime() + 86400000);
    if (
      !Number.isFinite(from.getTime()) ||
      !Number.isFinite(lastDay.getTime()) ||
      query.from !== new Date(from.getTime() + 19800000).toISOString().slice(0, 10) ||
      query.to !== new Date(lastDay.getTime() + 19800000).toISOString().slice(0, 10) ||
      from > lastDay ||
      until.getTime() - from.getTime() > 366 * 86400000
    )
      throw new AppError(400, 'Choose valid dates spanning at most 366 days');
    const report = await db.$transaction(
      async (tx) => {
        if (query.kind === 'stock') {
          const products = await tx.product.findMany({
            where: { businessId, active: true },
            orderBy: { name: 'asc' },
            take: 10001,
          });
          if (products.length > 10000) throw new AppError(400, 'Export limit is 10,000 products');
          const valueMinor = safeSum(products.map((p) => p.stock * p.costMinor));
          return {
            columns: ['SKU', 'Product', 'Stock', 'Reorder level', 'Cost LKR', 'Stock value LKR'],
            rows: products.map((p) => [
              p.sku,
              p.name,
              p.stock,
              p.reorderLevel,
              decimalMoney(p.costMinor),
              decimalMoney(p.stock * p.costMinor),
            ]),
            summary: { products: products.length, valueMinor },
          };
        }
        const where = { businessId, createdAt: { gte: from, lt: until } };
        const [sales, refunds] = await Promise.all([
          tx.sale.findMany({ where, orderBy: { createdAt: 'asc' }, take: 10001 }),
          tx.refund.findMany({
            where,
            include: { sale: { select: { invoiceNo: true } } },
            orderBy: { createdAt: 'asc' },
            take: 10001,
          }),
        ]);
        if (sales.length + refunds.length > 10000)
          throw new AppError(400, 'Export limit is 10,000 events; narrow the date range');
        const rows = [
          ...sales.map((s) => [
            s.createdAt.toISOString(),
            'SALE',
            `SF-${s.invoiceNo}`,
            decimalMoney(s.totalMinor),
          ]),
          ...refunds.map((r) => [
            r.createdAt.toISOString(),
            'REFUND',
            `SF-${r.sale.invoiceNo}`,
            decimalMoney(-r.totalMinor),
          ]),
        ].sort((a, b) => String(a[0]).localeCompare(String(b[0])));
        const grossMinor = safeSum(sales.map((s) => s.totalMinor));
        const refundMinor = safeSum(refunds.map((r) => r.totalMinor));
        return {
          columns: ['Timestamp UTC', 'Type', 'Invoice', 'Amount LKR'],
          rows,
          summary: {
            grossMinor,
            refundMinor,
            netMinor: grossMinor - refundMinor,
            sales: sales.length,
          },
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
    if (query.format === 'csv') {
      const numericColumns = new Set(
        report.columns.map((name, index) => (name.endsWith('LKR') ? index : -1)),
      );
      const rows = report.rows.map((row) =>
        row
          .map((value, index) =>
            numericColumns.has(index) && /^-?\d+\.\d{2}$/.test(String(value))
              ? `"${value}"`
              : csvCell(value),
          )
          .join(','),
      );
      return reply
        .type('text/csv; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="shopflow-${query.kind}.csv"`)
        .send('\uFEFF' + [report.columns.map(csvCell).join(','), ...rows].join('\r\n'));
    }
    if (query.format === 'pdf')
      return reply
        .type('application/pdf')
        .header('Content-Disposition', `attachment; filename="shopflow-${query.kind}.pdf"`)
        .send(
          await makePdf(
            `${query.kind === 'stock' ? 'Current stock' : 'Sales'} report | ${query.from} to ${query.to}`,
            [
              query.kind === 'stock'
                ? 'Stock is a current snapshot.'
                : 'Date range uses Sri Lanka local days. Refunds use their own event date.',
              ...Object.entries(report.summary).map(
                ([name, value]) =>
                  `${name}: ${name.endsWith('Minor') ? formatMoney(value) : value}`,
              ),
              report.columns.join(' | '),
              ...report.rows.map((row) => row.join(' | ')),
            ],
          ),
        );
    return report;
  });
  app.get('/audit', { preHandler: allow(manager) }, async (req) => {
    const { page } = pageQuery.parse(req.query);
    return db.audit.findMany({
      where: { businessId: req.identity!.businessId },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * 100,
      take: 100,
    });
  });
  return app;
}
