import { z } from 'zod';
import { atomic, type Db } from './db.js';
import {
  AppError,
  checkoutSchema,
  fingerprint,
  id,
  key,
  money,
  quantity,
  refundSchema,
  replay,
  sumMoney,
} from './domain.js';
export type Actor = { id: string; businessId: string; role: 'OWNER' | 'MANAGER' | 'CASHIER' };
export async function checkout(db: Db, actor: Actor, input: z.infer<typeof checkoutSchema>) {
  const data = checkoutSchema.parse(input);
  data.lines.sort((a, b) => a.productId.localeCompare(b.productId));
  const requestHash = fingerprint(data);
  return atomic(db, async (tx) => {
    const existing = await tx.sale.findUnique({
      where: {
        businessId_requestKey: { businessId: actor.businessId, requestKey: data.requestKey },
      },
      include: { lines: true },
    });
    if (existing) return replay(existing, requestHash);
    const lines = [];
    for (const line of data.lines) {
      const product = await tx.product.findFirst({
        where: { id: line.productId, businessId: actor.businessId, active: true },
      });
      if (!product) throw new AppError(404, 'Product unavailable');
      const changed = await tx.product.updateMany({
        where: {
          id: product.id,
          businessId: actor.businessId,
          active: true,
          stock: { gte: line.quantity },
        },
        data: { stock: { decrement: line.quantity } },
      });
      if (changed.count !== 1) throw new AppError(409, `Not enough stock for ${product.name}`);
      lines.push({
        businessId: actor.businessId,
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
    const sale = await tx.sale.create({
      data: {
        businessId: actor.businessId,
        requestKey: data.requestKey,
        requestHash,
        cashierId: actor.id,
        totalMinor,
        paidMinor: data.paidMinor,
        lines: { create: lines.map(({ businessId: _tenant, ...line }) => line) },
      },
      include: { lines: true },
    });
    await tx.stockMovement.createMany({
      data: lines.map((l) => ({
        businessId: actor.businessId,
        productId: l.productId,
        delta: -l.quantity,
        kind: 'SALE',
        referenceId: sale.id,
        actorId: actor.id,
      })),
    });
    await tx.audit.create({
      data: {
        businessId: actor.businessId,
        actorId: actor.id,
        action: 'SALE_CREATED',
        entityId: sale.id,
      },
    });
    return sale;
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
      .refine((ls) => new Set(ls.map((l) => l.productId)).size === ls.length, 'Duplicate product'),
  })
  .strict();
export async function receivePurchase(db: Db, actor: Actor, input: z.infer<typeof purchaseSchema>) {
  const data = purchaseSchema.parse(input);
  data.lines.sort((a, b) => a.productId.localeCompare(b.productId));
  const requestHash = fingerprint(data);
  return atomic(db, async (tx) => {
    const existing = await tx.purchase.findUnique({
      where: {
        businessId_requestKey: { businessId: actor.businessId, requestKey: data.requestKey },
      },
      include: { lines: true },
    });
    if (existing) return replay(existing, requestHash);
    if (
      !(await tx.supplier.findFirst({
        where: { id: data.supplierId, businessId: actor.businessId },
      }))
    )
      throw new AppError(404, 'Supplier not found');
    for (const line of data.lines) {
      const changed = await tx.product.updateMany({
        where: {
          id: line.productId,
          businessId: actor.businessId,
          active: true,
          stock: { lte: 2_000_000_000 - line.quantity },
        },
        data: { stock: { increment: line.quantity }, costMinor: line.costMinor },
      });
      if (changed.count !== 1)
        throw new AppError(409, 'Product unavailable or stock limit exceeded');
    }
    const totalMinor = sumMoney(
      data.lines.map((l) => ({ quantity: l.quantity, priceMinor: l.costMinor })),
    );
    const purchase = await tx.purchase.create({
      data: {
        businessId: actor.businessId,
        supplierId: data.supplierId,
        requestKey: data.requestKey,
        requestHash,
        totalMinor,
        lines: { create: data.lines },
      },
      include: { lines: true },
    });
    await tx.stockMovement.createMany({
      data: data.lines.map((l) => ({
        businessId: actor.businessId,
        productId: l.productId,
        delta: l.quantity,
        kind: 'PURCHASE',
        referenceId: purchase.id,
        actorId: actor.id,
      })),
    });
    await tx.audit.create({
      data: {
        businessId: actor.businessId,
        actorId: actor.id,
        action: 'PURCHASE_RECEIVED',
        entityId: purchase.id,
      },
    });
    return purchase;
  });
}
export async function refundSale(
  db: Db,
  actor: Actor,
  saleId: string,
  input: z.infer<typeof refundSchema>,
) {
  const data = refundSchema.parse(input);
  data.lines.sort((a, b) => a.saleLineId.localeCompare(b.saleLineId));
  const requestHash = fingerprint({ saleId, ...data });
  return atomic(db, async (tx) => {
    const existing = await tx.refund.findUnique({
      where: {
        businessId_requestKey: { businessId: actor.businessId, requestKey: data.requestKey },
      },
      include: { lines: true },
    });
    if (existing) return replay(existing, requestHash);
    const sale = await tx.sale.findFirst({
      where: { id: saleId, businessId: actor.businessId },
      include: { lines: true },
    });
    if (!sale) throw new AppError(404, 'Sale not found');
    const lines = [];
    for (const requested of data.lines) {
      const line = sale.lines.find((l) => l.id === requested.saleLineId);
      if (!line || requested.quantity > line.quantity - line.returnedQuantity)
        throw new AppError(409, 'Return quantity exceeds the unreturned quantity');
      // Conditional update plus serializable retry prevents two refunds returning the same units.
      const changed = await tx.saleLine.updateMany({
        where: {
          id: line.id,
          businessId: actor.businessId,
          returnedQuantity: line.returnedQuantity,
        },
        data: { returnedQuantity: { increment: requested.quantity } },
      });
      if (changed.count !== 1) throw new AppError(409, 'Sale changed; reload before refunding');
      const stock = await tx.product.updateMany({
        where: {
          id: line.productId,
          businessId: actor.businessId,
          stock: { lte: 2_000_000_000 - requested.quantity },
        },
        data: { stock: { increment: requested.quantity } },
      });
      if (stock.count !== 1) throw new AppError(409, 'Stock limit exceeded');
      lines.push({
        businessId: actor.businessId,
        saleLineId: line.id,
        quantity: requested.quantity,
        priceMinor: line.priceMinor,
      });
    }
    const refund = await tx.refund.create({
      data: {
        businessId: actor.businessId,
        saleId,
        requestKey: data.requestKey,
        requestHash,
        reason: data.reason,
        actorId: actor.id,
        totalMinor: sumMoney(lines),
        lines: { create: lines.map(({ businessId: _tenant, ...line }) => line) },
      },
      include: { lines: true },
    });
    await tx.stockMovement.createMany({
      data: data.lines.map((l) => ({
        businessId: actor.businessId,
        productId: sale.lines.find((s) => s.id === l.saleLineId)!.productId,
        delta: l.quantity,
        kind: 'REFUND',
        referenceId: refund.id,
        actorId: actor.id,
      })),
    });
    await tx.audit.create({
      data: {
        businessId: actor.businessId,
        actorId: actor.id,
        action: 'SALE_REFUNDED',
        entityId: refund.id,
      },
    });
    return refund;
  });
}
