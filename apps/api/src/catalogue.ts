import { z } from 'zod';
import type { Db } from './db.js';
import { atomic } from './db.js';
import { AppError, id, money } from './domain.js';
import type { Actor } from './trading.js';

export const barcodeSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9._/-]+$/, 'Use letters, digits, dots, dashes, underscores or slashes');
export const productDetails = z
  .object({
    sku: z.string().trim().min(1).max(60),
    name: z.string().trim().min(1).max(160),
    priceMinor: money,
    costMinor: money,
    reorderLevel: z.number().int().min(0).max(1_000_000),
    categoryId: id.nullable().optional(),
    barcode: barcodeSchema.nullable().optional(),
  })
  .strict();
export const productQuery = z
  .object({
    page: z.coerce.number().int().min(1).max(100_000).default(1),
    search: z.string().trim().max(160).default(''),
    categoryId: z.union([id, z.literal('uncategorized')]).optional(),
    stock: z.enum(['all', 'in_stock', 'low', 'out']).default('all'),
    sort: z
      .enum(['name-asc', 'name-desc', 'price-asc', 'price-desc', 'stock-asc', 'stock-desc'])
      .default('name-asc'),
    favourites: z.enum(['true', 'false']).default('false'),
  })
  .strict();
export function catalogueProduct<T extends { costMinor: number; favourites?: unknown[] }>(
  product: T,
  actor: Actor,
) {
  const { favourites, ...safe } = product;
  return {
    ...safe,
    costMinor: actor.role === 'CASHIER' ? undefined : product.costMinor,
    isFavourite: !!favourites?.length,
  };
}
export async function listProducts(db: Db, actor: Actor, query: z.infer<typeof productQuery>) {
  const { page, search, categoryId, stock, sort, favourites } = query;
  const where = {
    businessId: actor.businessId,
    active: true,
    ...(categoryId ? { categoryId: categoryId === 'uncategorized' ? null : categoryId } : {}),
    ...(favourites === 'true'
      ? { favourites: { some: { userId: actor.id, businessId: actor.businessId } } }
      : {}),
    ...(stock === 'out'
      ? { stock: 0 }
      : stock === 'in_stock'
        ? { stock: { gt: 0 } }
        : stock === 'low'
          ? { stock: { gt: 0, lte: db.product.fields.reorderLevel } }
          : {}),
    OR: [
      { name: { contains: search, mode: 'insensitive' as const } },
      { sku: { contains: search, mode: 'insensitive' as const } },
      { barcode: { contains: search, mode: 'insensitive' as const } },
    ],
  };
  const direction = sort.endsWith('desc') ? ('desc' as const) : ('asc' as const);
  const order = sort.startsWith('price')
    ? { priceMinor: direction }
    : sort.startsWith('stock')
      ? { stock: direction }
      : { name: direction };
  const [items, count] = await db.$transaction(
    [
      db.product.findMany({
        where,
        include: {
          category: true,
          favourites: { where: { userId: actor.id }, select: { userId: true } },
        },
        orderBy: [order, { id: 'asc' }],
        skip: (page - 1) * 50,
        take: 50,
      }),
      db.product.count({ where }),
    ],
    { isolationLevel: 'RepeatableRead' },
  );
  return {
    items: items.map((product) => catalogueProduct(product, actor)),
    count,
    page,
    pageSize: 50,
  };
}
export async function favouriteProduct(
  db: Db,
  actor: Actor,
  productId: string,
  favourite: boolean,
) {
  return atomic(db, async (tx) => {
    if (
      !(await tx.product.findFirst({
        where: { id: productId, businessId: actor.businessId, active: true },
        select: { id: true },
      }))
    )
      throw new AppError(404, 'Product not found');
    if (favourite)
      await tx.productFavourite.upsert({
        where: { userId_productId: { userId: actor.id, productId } },
        create: { businessId: actor.businessId, userId: actor.id, productId },
        update: {},
      });
    else
      await tx.productFavourite.deleteMany({
        where: { businessId: actor.businessId, userId: actor.id, productId },
      });
    return { isFavourite: favourite };
  });
}
