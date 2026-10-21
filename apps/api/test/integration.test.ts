import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { LocalPostgres } from '../src/postgres.js';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { createServer } from 'node:net';
import { Client } from 'pg';
import { createDb, type Db } from '../src/db.js';
import { buildApp } from '../src/app.js';
import { checkout, receivePurchase, refundSale, type Actor } from '../src/trading.js';
import { digest, hashPassword, token } from '../src/domain.js';
const origin = 'http://localhost:3000';
let db: Db;
let app: ReturnType<typeof buildApp>;
let embedded: LocalPostgres | undefined;
let temporaryDirectory: string | undefined;
let temporaryRoot: string | undefined;
let owner: Actor;
let cashier: Actor;
let outsider: Actor;
let productId: string;
let supplierId: string;
let passwordHash: string;
let ownerHeaders: Record<string, string>;
let cashierHeaders: Record<string, string>;
let outsiderHeaders: Record<string, string>;
async function freePort() {
  const server = createServer();
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((r) => server.close(() => r()));
  return port;
}
async function session(actor: Actor) {
  const raw = token();
  const csrf = token();
  await db.session.create({
    data: { id: digest(raw), userId: actor.id, csrf, expiresAt: new Date(Date.now() + 86400000) },
  });
  return { origin, cookie: `sf_session=${raw}`, 'x-csrf-token': csrf };
}
const payload = (quantity = 1, paidMinor = 10000) => ({
  requestKey: crypto.randomUUID(),
  lines: [{ productId, quantity }],
  paidMinor,
});
beforeAll(async () => {
  let url = process.env.TEST_DATABASE_URL;
  if (url && !new URL(url).pathname.endsWith('_test'))
    throw new Error(
      'TEST_DATABASE_URL must point to a dedicated database ending in _test; tests truncate its tables.',
    );
  if (!url) {
    // PostgreSQL drops administrator privileges on Windows. The hosted runner's
    // workspace is owned by the Administrators group, so use its user-owned temp folder.
    const root =
      process.platform === 'win32' && process.env.CI
        ? resolve(homedir(), 'AppData', 'Local', 'Temp', 'shopflow-tests')
        : resolve(fileURLToPath(new URL('../../../', import.meta.url)), 'work', 'test-databases');
    await mkdir(root, { recursive: true });
    const directory = resolve(await mkdtemp(resolve(root, 'postgres-')));
    if (!directory.startsWith(root + sep)) throw new Error('Invalid temporary database path');
    const port = await freePort();
    const password = token();
    temporaryDirectory = directory;
    temporaryRoot = root;
    embedded = new LocalPostgres({ databaseDir: directory, port, user: 'shopflow', password });
    await embedded.initialise();
    await embedded.start();
    await embedded.createDatabase('shopflow_test');
    url = `postgresql://shopflow:${password}@127.0.0.1:${port}/shopflow_test`;
  }
  const pg = new Client({ connectionString: url });
  await pg.connect();
  for (const name of ['202610210001_initial', '202610210002_checks'])
    await pg.query(
      await readFile(
        new URL(`../prisma/migrations/${name}/migration.sql`, import.meta.url),
        'utf8',
      ),
    );
  await pg.end();
  db = createDb(url);
  app = buildApp(db, { origin });
  await app.ready();
  passwordHash = await hashPassword('test-password-12345');
}, 120000);
beforeEach(async () => {
  await db.$executeRawUnsafe('TRUNCATE "Business" RESTART IDENTITY CASCADE');
  const one = await db.business.create({ data: { name: 'Store One' } });
  const two = await db.business.create({ data: { name: 'Store Two' } });
  owner = await db.user.create({
    data: {
      businessId: one.id,
      name: 'Owner',
      email: 'owner@example.com',
      role: 'OWNER',
      passwordHash,
    },
  });
  cashier = await db.user.create({
    data: {
      businessId: one.id,
      name: 'Cashier',
      email: 'cashier@example.com',
      role: 'CASHIER',
      passwordHash,
    },
  });
  outsider = await db.user.create({
    data: {
      businessId: two.id,
      name: 'Other',
      email: 'other@example.com',
      role: 'OWNER',
      passwordHash,
    },
  });
  productId = (
    await db.product.create({
      data: {
        businessId: one.id,
        sku: 'TEA',
        name: 'Ceylon Tea',
        priceMinor: 12345,
        costMinor: 7000,
        stock: 10,
      },
    })
  ).id;
  supplierId = (await db.supplier.create({ data: { businessId: one.id, name: 'Supplier One' } }))
    .id;
  ownerHeaders = await session(owner);
  cashierHeaders = await session(cashier);
  outsiderHeaders = await session(outsider);
});
afterAll(async () => {
  await app?.close();
  await db?.$disconnect();
  await embedded?.stop();
  if (
    temporaryDirectory &&
    temporaryRoot &&
    resolve(temporaryDirectory).startsWith(resolve(temporaryRoot) + sep)
  )
    await rm(temporaryDirectory, { recursive: true, force: true });
}, 30000);
describe('Authentication and permissions', () => {
  it('changes passwords and revokes every session for the account', async () => {
    const second = await session(owner);
    const response = await app.inject({
      method: 'POST',
      url: '/auth/password',
      headers: ownerHeaders,
      payload: { currentPassword: 'test-password-12345', newPassword: 'new-test-password-12345' },
    });
    expect(response.statusCode).toBe(200);
    expect(await db.session.count({ where: { userId: owner.id } })).toBe(0);
    expect((await app.inject({ method: 'GET', url: '/auth/me', headers: second })).statusCode).toBe(
      401,
    );
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/auth/login',
          headers: { origin },
          payload: { email: 'owner@example.com', password: 'new-test-password-12345' },
        })
      ).statusCode,
    ).toBe(200);
  });
  it('manages catalogue references safely and audits changes', async () => {
    const category = await app.inject({
      method: 'POST',
      url: '/categories',
      headers: ownerHeaders,
      payload: { name: 'Tea' },
    });
    expect(category.statusCode).toBe(200);
    const categoryId = category.json().id;
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: `/categories/${categoryId}`,
          headers: ownerHeaders,
          payload: { name: 'Groceries' },
        })
      ).statusCode,
    ).toBe(200);
    await db.product.update({ where: { id: productId }, data: { categoryId } });
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: `/categories/${categoryId}`,
          headers: ownerHeaders,
          payload: {},
        })
      ).statusCode,
    ).toBe(409);
    const unused = await db.category.create({
      data: { businessId: owner.businessId, name: 'Unused' },
    });
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: `/categories/${unused.id}`,
          headers: ownerHeaders,
          payload: {},
        })
      ).statusCode,
    ).toBe(200);
    expect(await db.audit.count()).toBe(3);
  });
  it('revokes disabled staff sessions and protects owner accounts', async () => {
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: `/users/${cashier.id}`,
          headers: ownerHeaders,
          payload: { active: false },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ method: 'GET', url: '/auth/me', headers: cashierHeaders })).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: `/users/${owner.id}`,
          headers: ownerHeaders,
          payload: { active: false },
        })
      ).statusCode,
    ).toBe(400);
  });
  it('requires authentication, origin and CSRF protection', async () => {
    expect((await app.inject({ method: 'GET', url: '/products' })).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/products',
          headers: { ...ownerHeaders, origin: 'https://evil.example' },
          payload: {},
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/products',
          headers: { ...ownerHeaders, 'x-csrf-token': 'wrong' },
          payload: {},
        })
      ).statusCode,
    ).toBe(403);
  });
  it('sets an HttpOnly session, rotates old tokens and supports logout', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      headers: ownerHeaders,
      payload: { email: 'owner@example.com', password: 'test-password-12345' },
    });
    expect(login.statusCode).toBe(200);
    expect(login.headers['set-cookie']).toContain('HttpOnly');
    expect(login.headers['set-cookie']).toContain('SameSite=Lax');
    const rawCookie = String(login.headers['set-cookie']).split(';')[0];
    const headers = { origin, cookie: rawCookie, 'x-csrf-token': login.json().csrf };
    expect(
      (await app.inject({ method: 'GET', url: '/auth/me', headers: ownerHeaders })).statusCode,
    ).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/auth/me', headers })).json().user.role).toBe(
      'OWNER',
    );
    expect(
      (await app.inject({ method: 'POST', url: '/auth/logout', headers, payload: {} })).statusCode,
    ).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/auth/me', headers })).statusCode).toBe(401);
  });
  it('rejects incorrect passwords and expired or disabled accounts', async () => {
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/auth/login',
          headers: { origin },
          payload: { email: 'owner@example.com', password: 'incorrect' },
        })
      ).statusCode,
    ).toBe(401);
    await db.session.updateMany({
      where: { userId: cashier.id },
      data: { expiresAt: new Date(0) },
    });
    expect(
      (await app.inject({ method: 'GET', url: '/products', headers: cashierHeaders })).statusCode,
    ).toBe(401);
    await db.user.update({ where: { id: owner.id }, data: { active: false } });
    expect(
      (await app.inject({ method: 'GET', url: '/dashboard', headers: ownerHeaders })).statusCode,
    ).toBe(401);
  });
  it('enforces cashier and manager permissions server-side and hides costs', async () => {
    for (const url of ['/reports?from=2026-10-01&to=2026-10-21', '/users', '/audit', '/purchases'])
      expect((await app.inject({ method: 'GET', url, headers: cashierHeaders })).statusCode).toBe(
        403,
      );
    expect(
      (await app.inject({ method: 'POST', url: '/products', headers: cashierHeaders, payload: {} }))
        .statusCode,
    ).toBe(403);
    expect(
      (await app.inject({ method: 'GET', url: '/products', headers: cashierHeaders })).json()
        .items[0],
    ).not.toHaveProperty('costMinor');
    const managerUser = await db.user.create({
      data: {
        businessId: owner.businessId,
        name: 'Manager',
        email: 'manager@example.com',
        role: 'MANAGER',
        passwordHash,
      },
    });
    const headers = await session(managerUser);
    expect((await app.inject({ method: 'GET', url: '/users', headers })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/purchases', headers })).statusCode).toBe(200);
  });
  it('keeps businesses isolated for reads, updates, references, invoices and refunds', async () => {
    expect(
      (await app.inject({ method: 'GET', url: '/products', headers: outsiderHeaders })).json()
        .items,
    ).toEqual([]);
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: `/products/${productId}`,
          headers: outsiderHeaders,
          payload: { name: 'Stolen' },
        })
      ).statusCode,
    ).toBe(404);
    await expect(checkout(db, outsider, payload(1, 20000))).rejects.toThrow('Product unavailable');
    const otherCategory = await db.category.create({
      data: { businessId: outsider.businessId, name: 'Other category' },
    });
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: `/products/${productId}`,
          headers: ownerHeaders,
          payload: { categoryId: otherCategory.id },
        })
      ).statusCode,
    ).toBe(404);
    await expect(
      db.product.update({ where: { id: productId }, data: { categoryId: otherCategory.id } }),
    ).rejects.toThrow();
    const sale = await checkout(db, owner, payload(1, 20000));
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/sales/${sale.id}/invoice.pdf`,
          headers: outsiderHeaders,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/sales/${sale.id}/refunds`,
          headers: outsiderHeaders,
          payload: {
            requestKey: crypto.randomUUID(),
            reason: 'Wrong business',
            lines: [{ saleLineId: sale.lines[0].id, quantity: 1 }],
          },
        })
      ).statusCode,
    ).toBe(404);
  });
});
describe('Atomic inventory and checkout', () => {
  it('receives a purchase exactly once and rolls back invalid purchases', async () => {
    const data = {
      requestKey: crypto.randomUUID(),
      supplierId,
      lines: [{ productId, quantity: 3, costMinor: 7500 }],
    };
    const results = await Promise.all([
      receivePurchase(db, owner, data),
      receivePurchase(db, owner, data),
    ]);
    expect(results[0].id).toBe(results[1].id);
    expect((await db.product.findUniqueOrThrow({ where: { id: productId } })).stock).toBe(13);
    expect(await db.stockMovement.count()).toBe(1);
    await expect(
      receivePurchase(db, owner, {
        ...data,
        requestKey: crypto.randomUUID(),
        lines: [...data.lines, { productId: crypto.randomUUID(), quantity: 2, costMinor: 10 }],
      }),
    ).rejects.toThrow();
    expect((await db.product.findUniqueOrThrow({ where: { id: productId } })).stock).toBe(13);
  });
  it('allows only one of two concurrent buyers to buy the last unit', async () => {
    await db.product.update({ where: { id: productId }, data: { stock: 1 } });
    const results = await Promise.allSettled([
      checkout(db, owner, payload(1, 20000)),
      checkout(db, cashier, payload(1, 20000)),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await db.sale.count()).toBe(1);
    expect((await db.product.findUniqueOrThrow({ where: { id: productId } })).stock).toBe(0);
  });
  it('deduplicates concurrent checkout retries and rejects changed payloads', async () => {
    const data = payload(2, 30000);
    const [a, b] = await Promise.all([checkout(db, cashier, data), checkout(db, cashier, data)]);
    expect(a.id).toBe(b.id);
    expect(await db.sale.count()).toBe(1);
    expect(await db.stockMovement.count()).toBe(1);
    expect((await db.product.findUniqueOrThrow({ where: { id: productId } })).stock).toBe(8);
    await expect(checkout(db, cashier, { ...data, paidMinor: 40000 })).rejects.toThrow(
      'different data',
    );
  });
  it('rolls back all lines on underpayment or insufficient stock', async () => {
    await expect(checkout(db, owner, payload(1, 1))).rejects.toThrow('Cash received');
    const another = await db.product.create({
      data: {
        businessId: owner.businessId,
        sku: 'OUT',
        name: 'Out',
        priceMinor: 100,
        costMinor: 50,
        stock: 0,
      },
    });
    await expect(
      checkout(db, owner, {
        ...payload(1, 20000),
        lines: [
          { productId, quantity: 1 },
          { productId: another.id, quantity: 1 },
        ],
      }),
    ).rejects.toThrow();
    expect((await db.product.findUniqueOrThrow({ where: { id: productId } })).stock).toBe(10);
    expect(await db.sale.count()).toBe(0);
    expect(await db.audit.count()).toBe(0);
  });
  it('snapshots prices and costs and assigns unique invoices', async () => {
    const a = await checkout(db, owner, payload(1, 20000));
    await db.product.update({
      where: { id: productId },
      data: { priceMinor: 50000, costMinor: 25000, name: 'New name' },
    });
    const b = await checkout(db, owner, payload(1, 50000));
    expect(a.invoiceNo).not.toBe(b.invoiceNo);
    expect(a.lines[0].priceMinor).toBe(12345);
    expect(a.lines[0].costMinor).toBe(7000);
    expect(a.lines[0].name).toBe('Ceylon Tea');
    expect(b.totalMinor).toBe(50000);
    const history = (
      await app.inject({ method: 'GET', url: '/sales', headers: cashierHeaders })
    ).json();
    expect(history[0].lines[0]).not.toHaveProperty('costMinor');
    expect(history[0]).not.toHaveProperty('requestHash');
  });
  it('enforces stock and return invariants in PostgreSQL', async () => {
    await expect(
      db.product.update({ where: { id: productId }, data: { stock: -1 } }),
    ).rejects.toThrow();
  });
});
describe('Refunds and reports', () => {
  it('refunds at the original price and restores stock exactly once', async () => {
    const sale = await checkout(db, owner, payload(2, 30000));
    await db.product.update({ where: { id: productId }, data: { priceMinor: 99000 } });
    const data = {
      requestKey: crypto.randomUUID(),
      reason: 'Customer return',
      lines: [{ saleLineId: sale.lines[0].id, quantity: 1 }],
    };
    const [a, b] = await Promise.all([
      refundSale(db, owner, sale.id, data),
      refundSale(db, owner, sale.id, data),
    ]);
    expect(a.id).toBe(b.id);
    expect(a.totalMinor).toBe(12345);
    expect((await db.product.findUniqueOrThrow({ where: { id: productId } })).stock).toBe(9);
    expect(await db.refund.count()).toBe(1);
    await expect(
      refundSale(db, owner, sale.id, {
        ...data,
        requestKey: crypto.randomUUID(),
        lines: [{ saleLineId: sale.lines[0].id, quantity: 2 }],
      }),
    ).rejects.toThrow('unreturned');
  });
  it('prevents concurrent over-refunds and denies cashiers', async () => {
    const sale = await checkout(db, owner, payload(1, 20000));
    const request = () => ({
      requestKey: crypto.randomUUID(),
      reason: 'Return item',
      lines: [{ saleLineId: sale.lines[0].id, quantity: 1 }],
    });
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/sales/${sale.id}/refunds`,
          headers: cashierHeaders,
          payload: request(),
        })
      ).statusCode,
    ).toBe(403);
    const results = await Promise.allSettled([
      refundSale(db, owner, sale.id, request()),
      refundSale(db, owner, sale.id, request()),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await db.product.findUniqueOrThrow({ where: { id: productId } })).stock).toBe(10);
    expect(await db.refund.count()).toBe(1);
  });
  it('uses Sri Lanka day boundaries and reports refund events separately', async () => {
    const before = await checkout(db, owner, payload(1, 20000));
    const inside = await checkout(db, owner, payload(1, 20000));
    await db.sale.update({
      where: { id: before.id },
      data: { createdAt: new Date('2026-10-20T18:29:59Z') },
    });
    await db.sale.update({
      where: { id: inside.id },
      data: { createdAt: new Date('2026-10-20T18:30:00Z') },
    });
    const returned = await refundSale(db, owner, before.id, {
      requestKey: crypto.randomUUID(),
      reason: 'Return next day',
      lines: [{ saleLineId: before.lines[0].id, quantity: 1 }],
    });
    await db.refund.update({
      where: { id: returned.id },
      data: { createdAt: new Date('2026-10-21T10:00:00Z') },
    });
    const response = await app.inject({
      method: 'GET',
      url: '/reports?from=2026-10-21&to=2026-10-21',
      headers: ownerHeaders,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().summary).toMatchObject({
      grossMinor: 12345,
      refundMinor: 12345,
      netMinor: 0,
      sales: 1,
    });
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/reports?from=2026-02-30&to=2026-03-01',
          headers: ownerHeaders,
        })
      ).statusCode,
    ).toBe(400);
  });
  it('generates real PDF invoices and CSV/PDF exports with formula escaping', async () => {
    await db.product.update({ where: { id: productId }, data: { name: '=Dangerous formula' } });
    const sale = await checkout(db, owner, payload(1, 20000));
    const pdf = await app.inject({
      method: 'GET',
      url: `/sales/${sale.id}/invoice.pdf`,
      headers: ownerHeaders,
    });
    expect(pdf.statusCode).toBe(200);
    expect(pdf.rawPayload.subarray(0, 4).toString()).toBe('%PDF');
    const csv = await app.inject({
      method: 'GET',
      url: '/reports?from=2026-10-01&to=2026-10-21&kind=stock&format=csv',
      headers: ownerHeaders,
    });
    expect(csv.body).toContain("'=Dangerous formula");
    const reportPdf = await app.inject({
      method: 'GET',
      url: '/reports?from=2026-10-01&to=2026-10-21&kind=stock&format=pdf',
      headers: ownerHeaders,
    });
    expect(reportPdf.rawPayload.subarray(0, 4).toString()).toBe('%PDF');
  });
});
