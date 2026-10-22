import { parse } from 'csv-parse/sync';
import { z } from 'zod';
import type { Db, Tx } from './db.js';
import { atomic } from './db.js';
import { AppError, digest, key, replay, toMinor } from './domain.js';
import { productDetails } from './catalogue.js';
import type { Actor } from './trading.js';

export const importPreviewBody = z.object({ csv: z.string().min(1).max(524288) }).strict();
export const importBody = importPreviewBody.extend({ requestKey: key }).strict();
type ProductData = z.infer<typeof productDetails>;
type CsvRow = { row: number; values: Record<string, string>; errors: string[]; data?: ProductData };
const columns = ['sku', 'name', 'price', 'cost', 'reorderLevel', 'category', 'barcode'];
export function parseProductCsv(csv: string): CsvRow[] {
  if (Buffer.byteLength(csv, 'utf8') > 524288)
    throw new AppError(400, 'CSV must be smaller than 512 KB');
  let records: string[][];
  try {
    records = parse(csv, {
      bom: true,
      skip_empty_lines: true,
      relax_column_count: true,
      max_record_size: 8192,
    }) as string[][];
  } catch {
    throw new AppError(400, 'CSV could not be read. Check quotation marks and row lengths.');
  }
  const headers = records.shift()?.map((header) => header.trim());
  if (
    !headers ||
    new Set(headers).size !== headers.length ||
    headers.some((header) => !columns.includes(header)) ||
    ['sku', 'name', 'price', 'cost'].some((header) => !headers.includes(header))
  )
    throw new AppError(
      400,
      'Use unique CSV headers: sku,name,price,cost; optional: reorderLevel,category,barcode',
    );
  if (!records.length || records.length > 500)
    throw new AppError(400, 'Import between 1 and 500 products at a time');
  return records.map((record, index) => {
    const values = Object.fromEntries(
      headers.map((header, position) => [header, (record[position] ?? '').trim()]),
    );
    const errors: string[] = [];
    if (record.length !== headers.length) errors.push('Column count does not match the header');
    let priceMinor = 0,
      costMinor = 0;
    try {
      priceMinor = toMinor(values.price!);
    } catch {
      errors.push('Price must be a valid LKR amount with at most two decimal places');
    }
    try {
      costMinor = toMinor(values.cost!);
    } catch {
      errors.push('Cost must be a valid LKR amount with at most two decimal places');
    }
    const reorder = values.reorderLevel || '5';
    const result = productDetails.safeParse({
      sku: values.sku,
      name: values.name,
      priceMinor,
      costMinor,
      reorderLevel: /^\d+$/.test(reorder) ? Number(reorder) : NaN,
      barcode: values.barcode || null,
    });
    if (!result.success)
      errors.push(
        ...result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
      );
    return {
      row: index + 2,
      values: Object.fromEntries(
        Object.entries(values).map(([name, value]) => [name, value.slice(0, 200)]),
      ),
      errors,
      ...(result.success ? { data: result.data } : {}),
    };
  });
}
async function inspectCsv(db: Db | Tx, businessId: string, csv: string) {
  const rows = parseProductCsv(csv);
  const categories = await db.category.findMany({
    where: { businessId, name: { in: rows.map((row) => row.values.category || '') } },
    select: { id: true, name: true },
  });
  const categoryIds = new Map(categories.map((category) => [category.name, category.id]));
  const products = await db.product.findMany({
    where: {
      businessId,
      OR: [
        { sku: { in: rows.flatMap((row) => (row.data ? [row.data.sku] : [])) } },
        { barcode: { in: rows.flatMap((row) => (row.data?.barcode ? [row.data.barcode] : [])) } },
      ],
    },
    select: { sku: true, barcode: true },
  });
  const existingSkus = new Set(products.map((product) => product.sku));
  const existingBarcodes = new Set(
    products.flatMap((product) => (product.barcode ? [product.barcode] : [])),
  );
  const skuCounts = new Map<string, number>(),
    barcodeCounts = new Map<string, number>();
  for (const row of rows)
    if (row.data) {
      skuCounts.set(row.data.sku, (skuCounts.get(row.data.sku) ?? 0) + 1);
      if (row.data.barcode)
        barcodeCounts.set(row.data.barcode, (barcodeCounts.get(row.data.barcode) ?? 0) + 1);
    }
  for (const row of rows) {
    if (row.values.category && !categoryIds.has(row.values.category))
      row.errors.push('Category must exactly match an existing category name');
    if (!row.data) continue;
    row.data.categoryId = row.values.category
      ? (categoryIds.get(row.values.category) ?? null)
      : null;
    if ((skuCounts.get(row.data.sku) ?? 0) > 1) row.errors.push('Duplicate SKU in this file');
    if (existingSkus.has(row.data.sku))
      row.errors.push('SKU already exists, including archived products');
    if (row.data.barcode && (barcodeCounts.get(row.data.barcode) ?? 0) > 1)
      row.errors.push('Duplicate barcode in this file');
    if (row.data.barcode && existingBarcodes.has(row.data.barcode))
      row.errors.push('Barcode already exists, including archived products');
  }
  return rows;
}
export async function previewProductImport(db: Db, businessId: string, csv: string) {
  const rows = await inspectCsv(db, businessId, csv);
  return {
    rows: rows.map(({ data: _data, ...row }) => row),
    total: rows.length,
    valid: rows.filter((row) => !row.errors.length).length,
  };
}
export async function importProducts(db: Db, actor: Actor, input: z.infer<typeof importBody>) {
  const requestHash = digest(input.csv);
  return atomic(db, async (tx) => {
    const existing = await tx.productImport.findUnique({
      where: {
        businessId_requestKey: { businessId: actor.businessId, requestKey: input.requestKey },
      },
    });
    if (existing) {
      replay(existing, requestHash);
      return { createdCount: existing.createdCount, requestKey: input.requestKey };
    }
    const rows = await inspectCsv(tx, actor.businessId, input.csv);
    if (rows.some((row) => row.errors.length || !row.data))
      throw new AppError(
        400,
        'Nothing imported. Preview the file again and correct every row error.',
      );
    await tx.product.createMany({
      data: rows.map((row) => ({ ...row.data!, businessId: actor.businessId })),
    });
    await tx.productImport.create({
      data: {
        businessId: actor.businessId,
        requestKey: input.requestKey,
        requestHash,
        actorId: actor.id,
        createdCount: rows.length,
      },
    });
    await tx.audit.create({
      data: {
        businessId: actor.businessId,
        actorId: actor.id,
        action: 'PRODUCTS_IMPORTED',
        entityId: input.requestKey,
      },
    });
    return { createdCount: rows.length, requestKey: input.requestKey };
  });
}
