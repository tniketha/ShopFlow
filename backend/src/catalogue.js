import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError, id, money } from './domain.js';
import { transaction } from './db.js';

const categoryBody = z.object({ name: z.string().trim().min(1).max(100) }).strict();
const supplierBody = categoryBody
  .extend({ contact: z.string().trim().max(200).nullable().optional() })
  .strict();
const productBody = z
  .object({
    sku: z.string().trim().min(1).max(60),
    name: z.string().trim().min(1).max(160),
    priceMinor: money,
    costMinor: money,
    categoryId: id.nullable().optional(),
  })
  .strict();
export const pageQuery = z
  .object({
    page: z.coerce.number().int().min(1).max(100000).default(1),
    search: z.string().trim().max(160).default(''),
  })
  .strict();

export function registerCatalogue(app, db, { auth, manager }) {
  app.get('/categories', auth, async (request, response) => {
    const { rows } = await db.query(
      'SELECT * FROM "Category" WHERE "businessId" = $1 ORDER BY name LIMIT 1000',
      [request.identity.businessId],
    );
    response.json(rows);
  });
  app.post('/categories', auth, manager, async (request, response) => {
    const data = categoryBody.parse(request.body);
    const { rows } = await db.query(
      'INSERT INTO "Category" (id, "businessId", name) VALUES ($1, $2, $3) RETURNING *',
      [randomUUID(), request.identity.businessId, data.name],
    );
    response.json(rows[0]);
  });
  app.patch('/categories/:id', auth, manager, async (request, response) => {
    const categoryId = id.parse(request.params.id);
    const data = categoryBody.parse(request.body);
    const result = await db.query(
      'UPDATE "Category" SET name = $3 WHERE id = $1 AND "businessId" = $2',
      [categoryId, request.identity.businessId, data.name],
    );
    if (!result.rowCount) throw new AppError(404, 'Category not found');
    response.json({ ok: true });
  });
  app.delete('/categories/:id', auth, manager, async (request, response) => {
    const result = await db.query('DELETE FROM "Category" WHERE id = $1 AND "businessId" = $2', [
      id.parse(request.params.id),
      request.identity.businessId,
    ]);
    if (!result.rowCount) throw new AppError(404, 'Category not found');
    response.json({ ok: true });
  });
  app.get('/suppliers', auth, manager, async (request, response) => {
    const { rows } = await db.query(
      'SELECT * FROM "Supplier" WHERE "businessId" = $1 ORDER BY name LIMIT 1000',
      [request.identity.businessId],
    );
    response.json(rows);
  });
  app.post('/suppliers', auth, manager, async (request, response) => {
    const data = supplierBody.parse(request.body);
    const { rows } = await db.query(
      'INSERT INTO "Supplier" (id, "businessId", name, contact) VALUES ($1, $2, $3, $4) RETURNING *',
      [randomUUID(), request.identity.businessId, data.name, data.contact ?? null],
    );
    response.json(rows[0]);
  });
  app.patch('/suppliers/:id', auth, manager, async (request, response) => {
    const supplierId = id.parse(request.params.id);
    const data = supplierBody.parse(request.body);
    const result = await db.query(
      'UPDATE "Supplier" SET name = $3, contact = CASE WHEN $4 THEN $5 ELSE contact END WHERE id = $1 AND "businessId" = $2',
      [
        supplierId,
        request.identity.businessId,
        data.name,
        Object.hasOwn(data, 'contact'),
        data.contact ?? null,
      ],
    );
    if (!result.rowCount) throw new AppError(404, 'Supplier not found');
    response.json({ ok: true });
  });
  app.delete('/suppliers/:id', auth, manager, async (request, response) => {
    const result = await db.query('DELETE FROM "Supplier" WHERE id = $1 AND "businessId" = $2', [
      id.parse(request.params.id),
      request.identity.businessId,
    ]);
    if (!result.rowCount) throw new AppError(404, 'Supplier not found');
    response.json({ ok: true });
  });
  app.get('/products', auth, async (request, response) => {
    const { page, search } = pageQuery.parse(request.query);
    // Treat %, _ and backslash as literal search characters, not SQL wildcards.
    const pattern = '%' + search.replace(/[\\%_]/g, '\\$&') + '%';
    const result = await transaction(
      db,
      async (client) => {
        const products = await client.query(
          `SELECT p.*, CASE WHEN c.id IS NULL THEN NULL ELSE json_build_object('id', c.id, 'name', c.name) END AS category
         FROM "Product" p LEFT JOIN "Category" c ON c.id = p."categoryId" AND c."businessId" = p."businessId"
         WHERE p."businessId" = $1 AND p.active = true AND (p.name ILIKE $2 OR p.sku ILIKE $2)
         ORDER BY p.name, p.id LIMIT 50 OFFSET $3`,
          [request.identity.businessId, pattern, (page - 1) * 50],
        );
        const count = await client.query(
          'SELECT count(*)::int AS count FROM "Product" WHERE "businessId" = $1 AND active = true AND (name ILIKE $2 OR sku ILIKE $2)',
          [request.identity.businessId, pattern],
        );
        return {
          items: products.rows.map((product) => {
            if (request.identity.role === 'CASHIER') delete product.costMinor;
            return product;
          }),
          count: count.rows[0].count,
          page,
          pageSize: 50,
        };
      },
      'REPEATABLE READ',
    );
    response.json(result);
  });
  async function checkCategory(categoryId, businessId) {
    if (!categoryId) return;
    const result = await db.query('SELECT id FROM "Category" WHERE id = $1 AND "businessId" = $2', [
      categoryId,
      businessId,
    ]);
    if (!result.rowCount) throw new AppError(404, 'Category not found');
  }
  app.post('/products', auth, manager, async (request, response) => {
    const data = productBody.parse(request.body);
    const businessId = request.identity.businessId;
    await checkCategory(data.categoryId, businessId);
    const { rows } = await db.query(
      `INSERT INTO "Product" (id, "businessId", sku, name, "priceMinor", "costMinor", "categoryId")
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [
        randomUUID(),
        businessId,
        data.sku,
        data.name,
        data.priceMinor,
        data.costMinor,
        data.categoryId ?? null,
      ],
    );
    response.json(rows[0]);
  });
  app.patch('/products/:id', auth, manager, async (request, response) => {
    const productId = id.parse(request.params.id);
    const data = productBody
      .partial()
      .extend({ active: z.boolean().optional() })
      .strict()
      .parse(request.body);
    const businessId = request.identity.businessId;
    await checkCategory(data.categoryId, businessId);
    // Field names come only from the validated schema; values are always parameters.
    const fields = Object.keys(data);
    if (!fields.length) throw new AppError(400, 'Provide a product field to update');
    const assignments = fields.map((field, index) => `"${field}" = $${index + 3}`);
    const result = await db.query(
      `UPDATE "Product" SET ${assignments.join(', ')} WHERE id = $1 AND "businessId" = $2`,
      [productId, businessId, ...fields.map((field) => data[field])],
    );
    if (!result.rowCount) throw new AppError(404, 'Product not found');
    response.json({ ok: true });
  });
}
