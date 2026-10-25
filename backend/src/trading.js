import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { transaction, findSale, findPurchase } from './db.js';
import {
  AppError,
  checkoutSchema,
  fingerprint,
  id,
  key,
  money,
  quantity,
  replay,
  sumMoney,
} from './domain.js';

export async function checkout(db, actor, input) {
  const data = checkoutSchema.parse(input);
  data.lines.sort((a, b) => a.productId.localeCompare(b.productId));
  const requestHash = fingerprint(data);
  return transaction(db, async (client) => {
    const existing = await findSale(client, actor.businessId, data.requestKey);
    if (existing) return replay(existing, requestHash);
    const lines = [];
    for (const line of data.lines) {
      const { rows } = await client.query(
        'SELECT * FROM "Product" WHERE id = $1 AND "businessId" = $2 AND active = true FOR UPDATE',
        [line.productId, actor.businessId],
      );
      const product = rows[0];
      if (!product) throw new AppError(404, 'Product unavailable');
      const changed = await client.query(
        'UPDATE "Product" SET stock = stock - $3 WHERE id = $1 AND "businessId" = $2 AND active = true AND stock >= $3',
        [product.id, actor.businessId, line.quantity],
      );
      if (changed.rowCount !== 1) throw new AppError(409, `Not enough stock for ${product.name}`);
      lines.push({
        id: randomUUID(),
        productId: product.id,
        sku: product.sku,
        name: product.name,
        quantity: line.quantity,
        priceMinor: product.priceMinor,
        costMinor: product.costMinor,
      });
    }
    const totalMinor = sumMoney(lines);
    if (data.paidMinor < totalMinor)
      throw new AppError(400, 'Cash received is below the sale total');
    const saleId = randomUUID();
    await client.query(
      `INSERT INTO "Sale" (id, "businessId", "requestKey", "requestHash", "cashierId", "totalMinor", "paidMinor")
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        saleId,
        actor.businessId,
        data.requestKey,
        requestHash,
        actor.id,
        totalMinor,
        data.paidMinor,
      ],
    );
    for (const line of lines) {
      await client.query(
        `INSERT INTO "SaleLine" (id, "businessId", "saleId", "productId", sku, name, quantity, "priceMinor", "costMinor")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          line.id,
          actor.businessId,
          saleId,
          line.productId,
          line.sku,
          line.name,
          line.quantity,
          line.priceMinor,
          line.costMinor,
        ],
      );
    }
    return findSale(client, actor.businessId, data.requestKey);
  });
}

export const purchaseSchema = z
  .object({
    requestKey: key,
    supplierId: id,
    lines: z
      .array(z.object({ productId: id, quantity, costMinor: money }).strict())
      .min(1)
      .max(100)
      .refine(
        (lines) => new Set(lines.map((line) => line.productId)).size === lines.length,
        'Duplicate product',
      ),
  })
  .strict();

export async function receivePurchase(db, actor, input) {
  if (!['OWNER', 'MANAGER'].includes(actor.role))
    throw new AppError(403, 'You do not have permission for this action');
  const data = purchaseSchema.parse(input);
  data.lines.sort((a, b) => a.productId.localeCompare(b.productId));
  const requestHash = fingerprint(data);
  return transaction(db, async (client) => {
    const existing = await findPurchase(client, actor.businessId, data.requestKey);
    if (existing) return replay(existing, requestHash);
    const supplier = await client.query(
      'SELECT id FROM "Supplier" WHERE id = $1 AND "businessId" = $2',
      [data.supplierId, actor.businessId],
    );
    if (!supplier.rowCount) throw new AppError(404, 'Supplier not found');
    for (const line of data.lines) {
      const changed = await client.query(
        `UPDATE "Product" SET stock = stock + $3, "costMinor" = $4
         WHERE id = $1 AND "businessId" = $2 AND active = true AND stock <= 2000000000 - $3`,
        [line.productId, actor.businessId, line.quantity, line.costMinor],
      );
      if (changed.rowCount !== 1)
        throw new AppError(409, 'Product unavailable or stock limit exceeded');
    }
    const totalMinor = sumMoney(
      data.lines.map((line) => ({ quantity: line.quantity, priceMinor: line.costMinor })),
    );
    const purchaseId = randomUUID();
    await client.query(
      `INSERT INTO "Purchase" (id, "businessId", "supplierId", "requestKey", "requestHash", "totalMinor")
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [purchaseId, actor.businessId, data.supplierId, data.requestKey, requestHash, totalMinor],
    );
    for (const line of data.lines) {
      await client.query(
        `INSERT INTO "PurchaseLine" (id, "businessId", "purchaseId", "productId", quantity, "costMinor") VALUES ($1, $2, $3, $4, $5, $6)`,
        [randomUUID(), actor.businessId, purchaseId, line.productId, line.quantity, line.costMinor],
      );
    }
    return findPurchase(client, actor.businessId, data.requestKey);
  });
}
