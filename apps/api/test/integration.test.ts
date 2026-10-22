import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { LocalPostgres } from '../src/postgres.js';
import { mkdtemp, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { createServer } from 'node:net';
import { Client } from 'pg';
import { createDb, type Db } from '../src/db.js';
import { buildApp } from '../src/app.js';
import { checkout, receivePurchase, refundSale, type Actor } from '../src/trading.js';
import { digest, hashPassword, token } from '../src/domain.js';
import sharp from 'sharp';
import { salesAnalytics } from '../src/analytics.js';
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
  for (const name of (
    await readdir(new URL('../prisma/migrations/', import.meta.url), { withFileTypes: true })
  )
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort())
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
describe('Catalogue tools and sales insights', () => {
  it('combines category, stock, search and price sorting within the current business', async () => {
    const category = await db.category.create({
      data: { businessId: owner.businessId, name: 'Tea' },
    });
    await db.product.update({
      where: { id: productId },
      data: { categoryId: category.id, stock: 2, barcode: 'TEA-100' },
    });
    await db.product.createMany({
      data: [
        {
          businessId: owner.businessId,
          name: 'Cheap Tea',
          sku: 'CHEAP',
          priceMinor: 100,
          costMinor: 50,
          stock: 0,
          categoryId: category.id,
        },
        {
          businessId: owner.businessId,
          name: 'Unsorted',
          sku: 'OTHER',
          priceMinor: 200,
          costMinor: 100,
          stock: 20,
        },
        {
          businessId: outsider.businessId,
          name: 'Private Tea',
          sku: 'PRIVATE',
          priceMinor: 1,
          costMinor: 1,
          stock: 1,
        },
      ],
    });
    const get = async (query: string) =>
      (
        await app.inject({ method: 'GET', url: '/products?' + query, headers: cashierHeaders })
      ).json();
    const low = await get(`categoryId=${category.id}&stock=low&sort=price-desc&search=tea`);
    expect(low.count).toBe(1);
    expect(low.items[0].id).toBe(productId);
    expect(low.items[0].costMinor).toBeUndefined();
    expect((await get('stock=out')).items.map((product: { sku: string }) => product.sku)).toEqual([
      'CHEAP',
    ]);
    expect(
      (await get('categoryId=uncategorized&stock=in_stock')).items.map(
        (product: { sku: string }) => product.sku,
      ),
    ).toEqual(['OTHER']);
    expect((await get('search=TEA-100')).items[0].id).toBe(productId);
    const sorted = await get('sort=price-asc');
    expect(sorted.items.map((product: { sku: string }) => product.sku)).toEqual([
      'CHEAP',
      'OTHER',
      'TEA',
    ]);
    expect((await get('search=Private')).count).toBe(0);
  });
  it('paginates equal-price products deterministically and rejects invalid filters', async () => {
    await db.product.createMany({
      data: Array.from({ length: 54 }, (_, index) => ({
        businessId: owner.businessId,
        name: 'Same',
        sku: 'PAGE-' + index,
        priceMinor: 100,
        costMinor: 50,
      })),
    });
    const get = async (page: number) =>
      (
        await app.inject({
          method: 'GET',
          url: `/products?search=Same&sort=price-asc&page=${page}`,
          headers: ownerHeaders,
        })
      ).json();
    const first = await get(1),
      second = await get(2),
      repeated = await get(1);
    expect(first.count).toBe(54);
    expect(first.items).toHaveLength(50);
    expect(second.items).toHaveLength(4);
    expect(first.items.map((p: { id: string }) => p.id)).toEqual(
      repeated.items.map((p: { id: string }) => p.id),
    );
    expect(new Set([...first.items, ...second.items].map((p: { id: string }) => p.id)).size).toBe(
      54,
    );
    for (const query of [
      'stock=bad',
      'sort=cost-desc',
      'categoryId=bad',
      'favourites=1',
      'page=0',
      'businessId=other',
    ])
      expect(
        (await app.inject({ method: 'GET', url: '/products?' + query, headers: ownerHeaders }))
          .statusCode,
      ).toBe(400);
  });
  it('keeps favourites personal, idempotent, authenticated and business-scoped', async () => {
    const mark = (headers: Record<string, string>, favourite: boolean) =>
      app.inject({
        method: 'PATCH',
        url: `/products/${productId}/favourite`,
        headers,
        payload: { favourite },
      });
    const results = await Promise.all([mark(cashierHeaders, true), mark(cashierHeaders, true)]);
    expect(results.every((response) => response.statusCode === 200)).toBe(true);
    expect(await db.productFavourite.count()).toBe(1);
    const mine = (
      await app.inject({ method: 'GET', url: '/products?favourites=true', headers: cashierHeaders })
    ).json();
    expect(mine.count).toBe(1);
    expect(mine.items[0].isFavourite).toBe(true);
    expect(mine.items[0].favourites).toBeUndefined();
    expect(
      (
        await app.inject({ method: 'GET', url: '/products?favourites=true', headers: ownerHeaders })
      ).json().count,
    ).toBe(0);
    expect((await mark(outsiderHeaders, true)).statusCode).toBe(404);
    expect((await mark({ ...ownerHeaders, 'x-csrf-token': 'wrong' }, true)).statusCode).toBe(403);
    expect((await mark(cashierHeaders, false)).statusCode).toBe(200);
    expect((await mark(cashierHeaders, false)).statusCode).toBe(200);
    expect(await db.productFavourite.count()).toBe(0);
    await db.product.update({ where: { id: productId }, data: { active: false } });
    expect((await mark(ownerHeaders, true)).statusCode).toBe(404);
  });
  it('looks up exact barcodes without leaking other stores, costs or archived stock', async () => {
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: `/products/${productId}`,
          headers: ownerHeaders,
          payload: { barcode: '8901234567890' },
        })
      ).statusCode,
    ).toBe(200);
    await db.product.create({
      data: {
        businessId: outsider.businessId,
        sku: 'OTHER',
        name: 'Other store product',
        barcode: '8901234567890',
        priceMinor: 100,
        costMinor: 20,
      },
    });
    const lookup = (headers: Record<string, string>, barcode: string) =>
      app.inject({
        method: 'GET',
        url: '/products/lookup?barcode=' + encodeURIComponent(barcode),
        headers,
      });
    const found = (await lookup(cashierHeaders, '8901234567890')).json();
    expect(found.id).toBe(productId);
    expect(found.costMinor).toBeUndefined();
    expect((await lookup(outsiderHeaders, '8901234567890')).json().name).toBe(
      'Other store product',
    );
    expect((await lookup(ownerHeaders, 'UNKNOWN')).statusCode).toBe(404);
    expect((await lookup(ownerHeaders, '<script>')).statusCode).toBe(400);
    const another = await db.product.create({
      data: {
        businessId: owner.businessId,
        sku: 'DUP',
        name: 'Duplicate test',
        priceMinor: 100,
        costMinor: 20,
      },
    });
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: `/products/${another.id}`,
          headers: ownerHeaders,
          payload: { barcode: '8901234567890' },
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: `/products/${productId}`,
          headers: cashierHeaders,
          payload: { barcode: 'NEW' },
        })
      ).statusCode,
    ).toBe(403);
    await db.product.update({ where: { id: productId }, data: { active: false } });
    expect((await lookup(ownerHeaders, '8901234567890')).statusCode).toBe(404);
  });
  it('previews quoted CSV values and reports duplicate, category and money errors without writes', async () => {
    const csv =
      '\uFEFFsku,name,price,cost,reorderLevel,category,barcode\r\nNEW,"Tea, premium",129.50,95.00,5,,NEW-1\r\nNEW,Other,10.001,2,5,Missing,NEW-1';
    const response = await app.inject({
      method: 'POST',
      url: '/products/import/preview',
      headers: ownerHeaders,
      payload: { csv },
    });
    expect(response.statusCode).toBe(200);
    const result = response.json();
    expect(result.total).toBe(2);
    expect(result.valid).toBe(0);
    expect(result.rows[0].values.name).toBe('Tea, premium');
    expect(result.rows[0].errors.join()).toContain('Duplicate SKU');
    expect(result.rows[1].errors.join()).toContain('Price');
    expect(result.rows[1].errors.join()).toContain('Category');
    expect(await db.product.count()).toBe(1);
    expect(await db.productImport.count()).toBe(0);
    for (const invalid of [
      'sku,name,price,cost,stock\nA,A,1,1,100',
      'sku,sku,name,price,cost\nA,B,C,1,1',
      'sku,name,price,cost\nA,"broken,1,1',
    ])
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/products/import/preview',
            headers: ownerHeaders,
            payload: { csv: invalid },
          })
        ).statusCode,
      ).toBe(400);
  });
  it('imports exact LKR values with zero stock and safely replays concurrent retries', async () => {
    const csv =
      'sku,name,price,cost,barcode\nIMPORT-A,Tea import,129.50,95.01,IMPORT-01\nIMPORT-B,Second,0.29,0,';
    const request = { csv, requestKey: crypto.randomUUID() };
    const send = (payload: typeof request) =>
      app.inject({ method: 'POST', url: '/products/import', headers: ownerHeaders, payload });
    const [first, repeated] = await Promise.all([send(request), send(request)]);
    expect(first.statusCode).toBe(200);
    expect(repeated.statusCode).toBe(200);
    expect(first.json()).toEqual(repeated.json());
    expect(first.json().createdCount).toBe(2);
    expect(await db.productImport.count()).toBe(1);
    expect(await db.audit.count({ where: { action: 'PRODUCTS_IMPORTED' } })).toBe(1);
    const product = await db.product.findUniqueOrThrow({
      where: { businessId_sku: { businessId: owner.businessId, sku: 'IMPORT-A' } },
    });
    expect(product.priceMinor).toBe(12950);
    expect(product.costMinor).toBe(9501);
    expect(product.stock).toBe(0);
    expect(product.barcode).toBe('IMPORT-01');
    expect((await send({ ...request, csv: csv.replace('129.50', '130.00') })).statusCode).toBe(409);
  });
  it('rolls back an invalid import and prevents concurrent duplicate-product batches', async () => {
    const send = (csv: string) =>
      app.inject({
        method: 'POST',
        url: '/products/import',
        headers: ownerHeaders,
        payload: { csv, requestKey: crypto.randomUUID() },
      });
    expect((await send('sku,name,price,cost\nGOOD,Good,1,1\nTEA,Duplicate,1,1')).statusCode).toBe(
      400,
    );
    expect(await db.product.count()).toBe(1);
    expect(await db.productImport.count()).toBe(0);
    const csv = 'sku,name,price,cost\nRACE,Concurrent,10,5';
    const responses = await Promise.all([send(csv), send(csv)]);
    expect(responses.filter((response) => response.statusCode === 200)).toHaveLength(1);
    expect(await db.product.count({ where: { sku: 'RACE', businessId: owner.businessId } })).toBe(
      1,
    );
    expect(await db.productImport.count()).toBe(1);
  });
  it('restricts imports to managers and validates commit bodies independently of previews', async () => {
    const csv = 'sku,name,price,cost\nNEW,New,1,0';
    for (const url of ['/products/import/preview', '/products/import']) {
      const payload = url.endsWith('preview') ? { csv } : { csv, requestKey: crypto.randomUUID() };
      expect(
        (await app.inject({ method: 'POST', url, headers: cashierHeaders, payload })).statusCode,
      ).toBe(403);
      expect(
        (
          await app.inject({
            method: 'POST',
            url,
            headers: { ...ownerHeaders, 'x-csrf-token': 'wrong' },
            payload,
          })
        ).statusCode,
      ).toBe(403);
    }
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/products/import',
          headers: ownerHeaders,
          payload: { csv, requestKey: crypto.randomUUID(), businessId: outsider.businessId },
        })
      ).statusCode,
    ).toBe(400);
    expect(await db.product.count()).toBe(1);
  });
  it('charts Sri Lanka dates, missing days, negative refund days and historical product snapshots', async () => {
    const older = await checkout(db, owner, payload(1, 20000));
    const inside = await checkout(db, owner, payload(1, 20000));
    await db.sale.update({
      where: { id: older.id },
      data: { createdAt: new Date('2026-10-20T18:29:59Z') },
    });
    await db.sale.update({
      where: { id: inside.id },
      data: { createdAt: new Date('2026-10-20T18:30:00Z') },
    });
    await db.product.update({ where: { id: productId }, data: { name: 'Updated Tea' } });
    const later = await checkout(db, owner, payload(2, 30000));
    await db.sale.update({
      where: { id: later.id },
      data: { createdAt: new Date('2026-10-24T08:00:00Z') },
    });
    await db.product.update({ where: { id: productId }, data: { name: 'Renamed after sale' } });
    const refund = await refundSale(db, owner, older.id, {
      requestKey: crypto.randomUUID(),
      reason: 'Later return',
      lines: [{ saleLineId: older.lines[0].id, quantity: 1 }],
    });
    await db.refund.update({
      where: { id: refund.id },
      data: { createdAt: new Date('2026-10-21T18:30:00Z') },
    });
    const data = await salesAnalytics(db, owner.businessId, 7, new Date('2026-10-27T12:00:00Z'));
    expect(data.from).toBe('2026-10-21');
    expect(data.to).toBe('2026-10-27');
    expect(data.daily).toHaveLength(7);
    expect(data.daily[0]).toMatchObject({ date: '2026-10-21', grossMinor: 12345, transactions: 1 });
    expect(data.daily[1]).toMatchObject({
      date: '2026-10-22',
      grossMinor: 0,
      refundMinor: 12345,
      netMinor: -12345,
    });
    expect(data.daily[2].netMinor).toBe(0);
    expect(data.summary).toMatchObject({
      grossMinor: 37035,
      refundMinor: 12345,
      netMinor: 24690,
      transactions: 2,
    });
    expect(data.topProducts).toEqual([
      { productId, name: 'Updated Tea', units: 3, revenueMinor: 37035 },
    ]);
    expect(
      (await salesAnalytics(db, outsider.businessId, 7, new Date('2026-10-27T12:00:00Z'))).summary
        .transactions,
    ).toBe(0);
  });
  it('limits top products to five and exposes charts only to owners/managers', async () => {
    for (let index = 1; index <= 6; index++) {
      const product = await db.product.create({
        data: {
          businessId: owner.businessId,
          sku: 'TOP-' + index,
          name: 'Top ' + index,
          priceMinor: 100,
          costMinor: 20,
          stock: 10,
        },
      });
      await checkout(db, owner, {
        requestKey: crypto.randomUUID(),
        paidMinor: 10000,
        lines: [{ productId: product.id, quantity: index }],
      });
    }
    const response = await app.inject({
      method: 'GET',
      url: '/analytics/sales?days=30',
      headers: ownerHeaders,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().daily).toHaveLength(30);
    expect(response.json().topProducts.map((p: { name: string }) => p.name)).toEqual([
      'Top 6',
      'Top 5',
      'Top 4',
      'Top 3',
      'Top 2',
    ]);
    expect(
      (await app.inject({ method: 'GET', url: '/analytics/sales', headers: cashierHeaders }))
        .statusCode,
    ).toBe(403);
    expect(
      (await app.inject({ method: 'GET', url: '/analytics/sales?days=8', headers: ownerHeaders }))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/analytics/sales?businessId=other',
          headers: ownerHeaders,
        })
      ).statusCode,
    ).toBe(400);
  });
});

describe('Authentication and permissions', () => {
  it('saves private photos atomically and serves only the current business', async () => {
    const image = await sharp({
      create: { width: 24, height: 24, channels: 3, background: '#708461' },
    })
      .png()
      .toBuffer();
    const response = await app.inject({
      method: 'PATCH',
      url: `/products/${productId}`,
      headers: ownerHeaders,
      payload: {
        photo: { kind: 'upload', data: 'data:image/png;base64,' + image.toString('base64') },
      },
    });
    expect(response.statusCode).toBe(200);
    const saved = await db.product.findUniqueOrThrow({ where: { id: productId } });
    expect(saved.photoKey).toBe('custom');
    expect(saved.photoVersion).toBeTruthy();
    const photo = await app.inject({
      method: 'GET',
      url: `/products/${productId}/photo`,
      headers: cashierHeaders,
    });
    expect(photo.statusCode).toBe(200);
    expect(photo.headers['content-type']).toContain('image/jpeg');
    expect(photo.headers['cache-control']).toBe('no-store');
    expect((await sharp(photo.rawPayload).metadata()).format).toBe('jpeg');
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/products/${productId}/photo`,
          headers: outsiderHeaders,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ method: 'GET', url: `/products/${productId}/photo` })).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: `/products/${productId}`,
          headers: outsiderHeaders,
          payload: { photo: { kind: 'library', key: 'rice' } },
        })
      ).statusCode,
    ).toBe(404);
    expect((await db.product.findUniqueOrThrow({ where: { id: productId } })).photoKey).toBe(
      'custom',
    );
    const reset = await app.inject({
      method: 'PATCH',
      url: `/products/${productId}`,
      headers: ownerHeaders,
      payload: { photo: { kind: 'library', key: 'tea' } },
    });
    expect(reset.statusCode).toBe(200);
    expect(await db.productPhoto.count()).toBe(0);
    expect(
      (await db.product.findUniqueOrThrow({ where: { id: productId } })).photoVersion,
    ).toBeNull();
  });
  it('rejects executable, corrupt, oversized and unapproved photo choices without changing stock or product', async () => {
    for (const photo of [
      {
        kind: 'upload',
        data: 'data:image/svg+xml;base64,' + Buffer.from('<svg/>').toString('base64'),
      },
      {
        kind: 'upload',
        data: 'data:image/jpeg;base64,' + Buffer.from('not a real photo').toString('base64'),
      },
      { kind: 'library', key: '../../outside' },
    ]) {
      const result = await app.inject({
        method: 'PATCH',
        url: `/products/${productId}`,
        headers: ownerHeaders,
        payload: { name: 'Changed', photo },
      });
      expect(result.statusCode).toBe(400);
    }
    const huge = await app.inject({
      method: 'PATCH',
      url: `/products/${productId}`,
      headers: ownerHeaders,
      payload: {
        photo: {
          kind: 'upload',
          data: 'data:image/jpeg;base64,' + Buffer.alloc(524289).toString('base64'),
        },
      },
    });
    expect(huge.statusCode).toBe(400);
    const saved = await db.product.findUniqueOrThrow({ where: { id: productId } });
    expect(saved.name).toBe('Ceylon Tea');
    expect(saved.stock).toBe(10);
    expect(saved.photoKey).toBeNull();
    expect(await db.productPhoto.count()).toBe(0);
  });
  it('enforces photo-edit permissions, CSRF and preserves a photo during ordinary edits', async () => {
    const payload = { photo: { kind: 'library', key: 'tea' } };
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: `/products/${productId}`,
          headers: cashierHeaders,
          payload,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: `/products/${productId}`,
          headers: { ...ownerHeaders, 'x-csrf-token': 'wrong' },
          payload,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: `/products/${productId}`,
          headers: ownerHeaders,
          payload,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: `/products/${productId}`,
          headers: ownerHeaders,
          payload: { name: 'Renamed Tea' },
        })
      ).statusCode,
    ).toBe(200);
    expect((await db.product.findUniqueOrThrow({ where: { id: productId } })).photoKey).toBe('tea');
    const list = (
      await app.inject({ method: 'GET', url: '/products', headers: cashierHeaders })
    ).json();
    expect(list.items[0].photoKey).toBe('tea');
    expect(list.items[0].costMinor).toBeUndefined();
  });
  it('creates a product with its photo and supports removing or resetting its reference photo', async () => {
    const image = await sharp({ create: { width: 8, height: 8, channels: 3, background: 'white' } })
      .webp()
      .toBuffer();
    const created = await app.inject({
      method: 'POST',
      url: '/products',
      headers: ownerHeaders,
      payload: {
        sku: 'PHOTO',
        name: 'Photo product',
        priceMinor: 100,
        costMinor: 50,
        reorderLevel: 2,
        photo: { kind: 'upload', data: 'data:image/webp;base64,' + image.toString('base64') },
      },
    });
    expect(created.statusCode).toBe(200);
    const product = created.json();
    expect(product.photoKey).toBe('custom');
    for (const kind of ['none', 'automatic']) {
      expect(
        (
          await app.inject({
            method: 'PATCH',
            url: `/products/${product.id}`,
            headers: ownerHeaders,
            payload: { photo: { kind } },
          })
        ).statusCode,
      ).toBe(200);
      expect((await db.product.findUniqueOrThrow({ where: { id: product.id } })).photoKey).toBe(
        kind === 'none' ? 'none' : null,
      );
      expect(await db.productPhoto.count()).toBe(0);
    }
  });
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
