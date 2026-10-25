import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { createServer } from 'node:net';
import { LocalPostgres } from '../src/postgres.js';
import { createDb } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { buildApp } from '../src/app.js';
import { checkout, receivePurchase } from '../src/trading.js';
import { digest, hashPassword, token } from '../src/domain.js';

const origin = 'http://localhost:3000';
let db, app, embedded, temporaryDirectory, temporaryRoot, passwordHash;
let owner, cashier, outsider, manager, productId, supplierId;
let ownerHeaders, cashierHeaders, outsiderHeaders, managerHeaders;

async function freePort() {
  const server = createServer();
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const port = server.address().port;
  await new Promise((done) => server.close(done));
  return port;
}
async function session(actor) {
  const raw = token();
  const csrf = token();
  await db.query(
    'INSERT INTO "Session" (id, "userId", csrf, "expiresAt") VALUES ($1, $2, $3, $4)',
    [digest(raw), actor.id, csrf, new Date(Date.now() + 86400000)],
  );
  return { origin, cookie: `sf_session=${raw}`, 'x-csrf-token': csrf };
}
async function user(businessId, role, email) {
  const { rows } = await db.query(
    'INSERT INTO "User" (id, "businessId", name, email, role, "passwordHash") VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
    [randomUUID(), businessId, role, email, role, passwordHash],
  );
  return rows[0];
}
const payload = (quantity = 1, paidMinor = 20000) => ({
  requestKey: randomUUID(),
  lines: [{ productId, quantity }],
  paidMinor,
});
const purchase = () => ({
  requestKey: randomUUID(),
  supplierId,
  lines: [{ productId, quantity: 3, costMinor: 7500 }],
});
const product = async () =>
  (await db.query('SELECT * FROM "Product" WHERE id = $1', [productId])).rows[0];
const saleCount = async () =>
  (await db.query('SELECT count(*)::int AS count FROM "Sale"')).rows[0].count;

beforeAll(async () => {
  let url = process.env.TEST_DATABASE_URL;
  if (url && !new URL(url).pathname.endsWith('_test'))
    throw new Error(
      'TEST_DATABASE_URL must name a dedicated database ending in _test; tests clear its tables.',
    );
  if (!url) {
    temporaryRoot =
      process.platform === 'win32' && process.env.CI
        ? resolve(homedir(), 'AppData', 'Local', 'Temp', 'shopflow-tests')
        : resolve(fileURLToPath(new URL('../../', import.meta.url)), 'work', 'test-databases');
    await mkdir(temporaryRoot, { recursive: true });
    temporaryDirectory = await mkdtemp(resolve(temporaryRoot, 'postgres-'));
    if (!resolve(temporaryDirectory).startsWith(temporaryRoot + sep))
      throw new Error('Invalid temporary database path');
    const port = await freePort();
    const password = token();
    embedded = new LocalPostgres({
      databaseDir: temporaryDirectory,
      port,
      user: 'shopflow',
      password,
    });
    await embedded.initialise();
    await embedded.start();
    await embedded.createDatabase('shopflow_test');
    url = `postgresql://shopflow:${password}@127.0.0.1:${port}/shopflow_test`;
  }
  db = createDb(url);
  // The dedicated test database is deliberately rebuilt, never the app database.
  await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
  await migrate(db);
  passwordHash = await hashPassword('test-password-12345');
}, 120000);

beforeEach(async () => {
  await db.query('TRUNCATE "Business" RESTART IDENTITY CASCADE');
  const businessId = randomUUID();
  const otherId = randomUUID();
  await db.query('INSERT INTO "Business" (id, name) VALUES ($1, $2), ($3, $4)', [
    businessId,
    'Store One',
    otherId,
    'Store Two',
  ]);
  owner = await user(businessId, 'OWNER', 'owner@example.com');
  cashier = await user(businessId, 'CASHIER', 'cashier@example.com');
  manager = await user(businessId, 'MANAGER', 'manager@example.com');
  outsider = await user(otherId, 'OWNER', 'other@example.com');
  productId = randomUUID();
  supplierId = randomUUID();
  await db.query(
    'INSERT INTO "Product" (id, "businessId", sku, name, "priceMinor", "costMinor", stock) VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [productId, businessId, 'TEA', 'Ceylon Tea', 12345, 7000, 10],
  );
  await db.query('INSERT INTO "Supplier" (id, "businessId", name) VALUES ($1, $2, $3)', [
    supplierId,
    businessId,
    'Supplier One',
  ]);
  ownerHeaders = await session(owner);
  cashierHeaders = await session(cashier);
  outsiderHeaders = await session(outsider);
  managerHeaders = await session(manager);
  app = buildApp(db, { origin, logger: true });
});

afterAll(async () => {
  await db?.end();
  await embedded?.stop();
  if (
    temporaryDirectory &&
    temporaryRoot &&
    resolve(temporaryDirectory).startsWith(resolve(temporaryRoot) + sep)
  )
    await rm(temporaryDirectory, { recursive: true, force: true });
}, 30000);

describe('Authentication and request safety', () => {
  it('requires authentication, the configured origin and CSRF protection', async () => {
    expect((await request(app).get('/products')).status).toBe(401);
    expect(
      (
        await request(app)
          .post('/products')
          .set({ ...ownerHeaders, origin: 'https://evil.example' })
          .send({})
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .post('/products')
          .set({ ...ownerHeaders, 'x-csrf-token': 'wrong' })
          .send({})
      ).status,
    ).toBe(403);
  });
  it('creates an HttpOnly session, rotates the previous session and logs out', async () => {
    const login = await request(app)
      .post('/auth/login')
      .set(ownerHeaders)
      .send({ email: 'owner@example.com', password: 'test-password-12345' });
    expect(login.status).toBe(200);
    expect(login.headers['set-cookie'][0]).toContain('HttpOnly');
    expect(login.headers['set-cookie'][0]).toContain('SameSite=Lax');
    const headers = {
      origin,
      cookie: login.headers['set-cookie'][0].split(';')[0],
      'x-csrf-token': login.body.csrf,
    };
    expect((await request(app).get('/auth/me').set(ownerHeaders)).status).toBe(401);
    expect((await request(app).get('/auth/me').set(headers)).body.user.role).toBe('OWNER');
    expect((await request(app).post('/auth/logout').set(headers).send({})).status).toBe(200);
    expect((await request(app).get('/auth/me').set(headers)).status).toBe(401);
  });
  it('rejects wrong passwords and expired or disabled accounts', async () => {
    expect(
      (
        await request(app)
          .post('/auth/login')
          .set({ origin })
          .send({ email: 'owner@example.com', password: 'incorrect' })
      ).status,
    ).toBe(401);
    await db.query('UPDATE "Session" SET "expiresAt" = $2 WHERE "userId" = $1', [
      cashier.id,
      new Date(0),
    ]);
    expect((await request(app).get('/products').set(cashierHeaders)).status).toBe(401);
    await db.query('UPDATE "User" SET active = false WHERE id = $1', [owner.id]);
    expect((await request(app).get('/dashboard').set(ownerHeaders)).status).toBe(401);
  });
  it('limits repeated login attempts and rejects malformed JSON', async () => {
    for (let index = 0; index < 5; index++)
      await request(app).post('/auth/login').set({ origin }).send({});
    expect((await request(app).post('/auth/login').set({ origin }).send({})).status).toBe(429);
    expect(
      (
        await request(app)
          .post('/sales')
          .set(ownerHeaders)
          .set('Content-Type', 'application/json')
          .send('{')
      ).status,
    ).toBe(400);
  });
  it('uses secure production cookies without exposing hashes or session IDs', async () => {
    const production = buildApp(db, { origin: 'https://shop.example', production: true });
    const login = await request(production)
      .post('/auth/login')
      .set({ origin: 'https://shop.example' })
      .send({ email: 'owner@example.com', password: 'test-password-12345' });
    expect(login.status).toBe(200);
    expect(login.headers['set-cookie'][0]).toContain('__Host-shopflow=');
    expect(login.headers['set-cookie'][0]).toContain('Secure');
    expect(login.body.user).not.toHaveProperty('passwordHash');
  });
});

describe('Catalogue and permissions', () => {
  it('creates, edits, lists and deletes unused categories and suppliers', async () => {
    const category = await request(app)
      .post('/categories')
      .set(ownerHeaders)
      .send({ name: 'Groceries' });
    expect(category.status).toBe(200);
    expect(
      (
        await request(app)
          .patch('/categories/' + category.body.id)
          .set(ownerHeaders)
          .send({ name: 'Food' })
      ).status,
    ).toBe(200);
    expect((await request(app).get('/categories').set(ownerHeaders)).body[0].name).toBe('Food');
    expect(
      (
        await request(app)
          .delete('/categories/' + category.body.id)
          .set(ownerHeaders)
      ).status,
    ).toBe(200);
    const supplier = await request(app)
      .post('/suppliers')
      .set(ownerHeaders)
      .send({ name: 'New Supplier', contact: '0712345678' });
    expect(supplier.status).toBe(200);
    expect(
      (
        await request(app)
          .patch('/suppliers/' + supplier.body.id)
          .set(ownerHeaders)
          .send({ name: 'Updated' })
      ).status,
    ).toBe(200);
    expect(
      (await request(app).get('/suppliers').set(ownerHeaders)).body.find(
        (entry) => entry.id === supplier.body.id,
      ).contact,
    ).toBe('0712345678');
    expect(
      (
        await request(app)
          .delete('/suppliers/' + supplier.body.id)
          .set(ownerHeaders)
      ).status,
    ).toBe(200);
  });
  it('adds products at zero stock, updates and archives them and enforces uniqueness', async () => {
    const body = { sku: 'RICE', name: 'Rice', priceMinor: 29500, costMinor: 20000 };
    const added = await request(app).post('/products').set(ownerHeaders).send(body);
    expect(added.status).toBe(200);
    expect(added.body.stock).toBe(0);
    expect((await request(app).post('/products').set(ownerHeaders).send(body)).status).toBe(409);
    expect(
      (
        await request(app)
          .patch('/products/' + added.body.id)
          .set(ownerHeaders)
          .send({ priceMinor: 30000, active: false })
      ).status,
    ).toBe(200);
    expect((await request(app).get('/products').set(ownerHeaders)).body.count).toBe(1);
    expect(
      (
        await request(app)
          .patch('/products/' + productId)
          .set(ownerHeaders)
          .send({ stock: 999 })
      ).status,
    ).toBe(400);
  });
  it('keeps stable pagination and treats search input as literal data', async () => {
    for (let index = 0; index < 52; index++)
      await db.query(
        'INSERT INTO "Product" (id, "businessId", sku, name, "priceMinor", "costMinor") VALUES ($1, $2, $3, $4, 100, 50)',
        [randomUUID(), owner.businessId, 'SKU-' + index, 'Same name'],
      );
    const first = (await request(app).get('/products?page=1').set(ownerHeaders)).body;
    const second = (await request(app).get('/products?page=2').set(ownerHeaders)).body;
    expect(first.count).toBe(53);
    expect(first.items).toHaveLength(50);
    expect(second.items).toHaveLength(3);
    expect(new Set([...first.items, ...second.items].map((entry) => entry.id)).size).toBe(53);
    expect(
      (await request(app).get('/products').query({ search: 'ceYLON' }).set(ownerHeaders)).body
        .count,
    ).toBe(1);
    for (const search of ['%', '_', "' OR 1=1 --"])
      expect(
        (await request(app).get('/products').query({ search }).set(ownerHeaders)).body.count,
      ).toBe(0);
  });
  it('restricts cashiers and lets managers manage stock', async () => {
    expect((await request(app).post('/products').set(cashierHeaders).send({})).status).toBe(403);
    expect((await request(app).get('/suppliers').set(cashierHeaders)).status).toBe(403);
    expect((await request(app).get('/purchases').set(cashierHeaders)).status).toBe(403);
    expect(
      (await request(app).get('/products').set(cashierHeaders)).body.items[0],
    ).not.toHaveProperty('costMinor');
    expect(
      (await request(app).post('/categories').set(managerHeaders).send({ name: 'Managed' })).status,
    ).toBe(200);
    await expect(receivePurchase(db, cashier, purchase())).rejects.toThrow('permission');
  });
  it('keeps store data separate and rejects cross-store relationships', async () => {
    expect((await request(app).get('/products').set(outsiderHeaders)).body.items).toEqual([]);
    expect(
      (
        await request(app)
          .patch('/products/' + productId)
          .set(outsiderHeaders)
          .send({ name: 'Changed' })
      ).status,
    ).toBe(404);
    await expect(checkout(db, outsider, payload())).rejects.toThrow('Product unavailable');
    await expect(receivePurchase(db, outsider, purchase())).rejects.toThrow('Supplier not found');
    const categoryId = randomUUID();
    await db.query('INSERT INTO "Category" (id, "businessId", name) VALUES ($1, $2, $3)', [
      categoryId,
      outsider.businessId,
      'Private',
    ]);
    expect(
      (
        await request(app)
          .patch('/products/' + productId)
          .set(ownerHeaders)
          .send({ categoryId })
      ).status,
    ).toBe(404);
    await expect(
      db.query('UPDATE "Product" SET "categoryId" = $2 WHERE id = $1', [productId, categoryId]),
    ).rejects.toThrow();
    await checkout(db, owner, payload());
    expect((await request(app).get('/sales').set(outsiderHeaders)).body).toEqual([]);
    expect((await request(app).get('/purchases').set(outsiderHeaders)).body).toEqual([]);
  });
  it('keeps referenced categories and suppliers and enforces database stock limits', async () => {
    const category = await request(app).post('/categories').set(ownerHeaders).send({ name: 'Tea' });
    await request(app)
      .patch('/products/' + productId)
      .set(ownerHeaders)
      .send({ categoryId: category.body.id });
    expect(
      (
        await request(app)
          .delete('/categories/' + category.body.id)
          .set(ownerHeaders)
      ).status,
    ).toBe(400);
    await receivePurchase(db, owner, purchase());
    expect(
      (
        await request(app)
          .delete('/suppliers/' + supplierId)
          .set(ownerHeaders)
      ).status,
    ).toBe(400);
    await expect(
      db.query('UPDATE "Product" SET stock = -1 WHERE id = $1', [productId]),
    ).rejects.toThrow();
  });
});

describe('Atomic purchases and checkout', () => {
  it('receives a simultaneous repeated purchase once and rejects a changed retry', async () => {
    const data = purchase();
    const results = await Promise.all([
      receivePurchase(db, owner, data),
      receivePurchase(db, owner, data),
    ]);
    expect(results[0].id).toBe(results[1].id);
    expect((await product()).stock).toBe(13);
    await expect(
      receivePurchase(db, owner, { ...data, lines: [{ productId, quantity: 4, costMinor: 7500 }] }),
    ).rejects.toThrow('different data');
    const purchases = (await request(app).get('/purchases').set(ownerHeaders)).body;
    expect(purchases).toHaveLength(1);
    expect(purchases[0].supplier.name).toBe('Supplier One');
    expect(purchases[0].lines).toHaveLength(1);
  });
  it('rolls back a purchase when any product is invalid or would overflow stock', async () => {
    const data = purchase();
    await expect(
      receivePurchase(db, owner, {
        ...data,
        lines: [...data.lines, { productId: randomUUID(), quantity: 2, costMinor: 10 }],
      }),
    ).rejects.toThrow();
    expect((await product()).stock).toBe(10);
    await db.query('UPDATE "Product" SET stock = 2000000000 WHERE id = $1', [productId]);
    await expect(receivePurchase(db, owner, data)).rejects.toThrow('stock limit');
    expect((await product()).stock).toBe(2000000000);
  });
  it('allows only one of two concurrent buyers to buy the last unit', async () => {
    await db.query('UPDATE "Product" SET stock = 1 WHERE id = $1', [productId]);
    const results = await Promise.allSettled([
      checkout(db, owner, payload()),
      checkout(db, cashier, payload()),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(await saleCount()).toBe(1);
    expect((await product()).stock).toBe(0);
  });
  it('returns one sale for concurrent duplicate checkouts and rejects changed retries', async () => {
    const data = payload();
    const results = await Promise.all([checkout(db, owner, data), checkout(db, owner, data)]);
    expect(results[0].id).toBe(results[1].id);
    expect(await saleCount()).toBe(1);
    expect((await product()).stock).toBe(9);
    await expect(checkout(db, owner, { ...data, paidMinor: 30000 })).rejects.toThrow(
      'different data',
    );
  });
  it('rolls back underpayment, missing products and insufficient stock', async () => {
    await expect(checkout(db, owner, payload(1, 1))).rejects.toThrow('below');
    await expect(checkout(db, owner, payload(11, 200000))).rejects.toThrow('Not enough stock');
    const data = payload();
    data.lines.push({ productId: randomUUID(), quantity: 1 });
    await expect(checkout(db, owner, data)).rejects.toThrow();
    expect((await product()).stock).toBe(10);
    expect(await saleCount()).toBe(0);
  });
  it('keeps name and price snapshots, unique sale numbers and private cost values', async () => {
    const first = await request(app).post('/sales').set(cashierHeaders).send(payload());
    expect(first.status).toBe(200);
    expect(first.body.totalMinor).toBe(12345);
    expect(first.body.lines[0]).not.toHaveProperty('costMinor');
    await db.query('UPDATE "Product" SET name = $2, "priceMinor" = 500 WHERE id = $1', [
      productId,
      'New name',
    ]);
    const second = await checkout(db, owner, payload());
    expect(second.invoiceNo).not.toBe(first.body.invoiceNo);
    const sales = (await request(app).get('/sales').set(cashierHeaders)).body;
    const saved = sales.find((sale) => sale.id === first.body.id);
    expect(saved.lines[0]).toMatchObject({ name: 'Ceylon Tea', priceMinor: 12345 });
    expect(saved.lines[0]).not.toHaveProperty('costMinor');
  });
  it('shows exact daily sales using Sri Lanka midnight boundaries', async () => {
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Colombo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    const midnight = new Date(today + 'T00:00:00+05:30');
    const previous = await checkout(db, owner, payload());
    const current = await checkout(db, owner, payload(2, 30000));
    await db.query('UPDATE "Sale" SET "createdAt" = $2 WHERE id = $1', [
      previous.id,
      new Date(midnight.getTime() - 1),
    ]);
    await db.query('UPDATE "Sale" SET "createdAt" = $2 WHERE id = $1', [current.id, midnight]);
    const dashboard = (await request(app).get('/dashboard').set(ownerHeaders)).body;
    expect(dashboard).toMatchObject({
      today,
      totalMinor: 24690,
      saleCount: 1,
      productCount: 1,
      stockCount: 7,
    });
    expect(dashboard.recentSales).toHaveLength(2);
  });
});

describe('SQL migrations', () => {
  it('runs repeatedly without changing store records', async () => {
    await migrate(db);
    await migrate(db);
    expect((await product()).stock).toBe(10);
    expect((await db.query('SELECT * FROM schema_migrations')).rowCount).toBe(1);
  });
  it('recognizes existing compatible tables without deleting products or accounts', async () => {
    await db.query('DELETE FROM schema_migrations');
    await migrate(db);
    expect((await product()).name).toBe('Ceylon Tea');
    expect((await db.query('SELECT id FROM "User" WHERE id = $1', [owner.id])).rowCount).toBe(1);
  });
});
