import { randomUUID } from 'node:crypto';
import { createDb, transaction } from './db.js';

// Prices and costs are integer cents, matching the existing product schema.
const samples = [
  { sku: 'SAMPLE-RICE-1KG', name: 'White Rice 1 kg', priceMinor: 26000, costMinor: 22000 },
  { sku: 'SAMPLE-SUGAR-1KG', name: 'White Sugar 1 kg', priceMinor: 30000, costMinor: 26000 },
  { sku: 'SAMPLE-TEA-100G', name: 'Ceylon Tea 100 g', priceMinor: 35000, costMinor: 28000 },
  { sku: 'SAMPLE-MILK-400G', name: 'Milk Powder 400 g', priceMinor: 110000, costMinor: 95000 },
  {
    sku: 'SAMPLE-BISCUITS-200G',
    name: 'Cream Crackers 200 g',
    priceMinor: 25000,
    costMinor: 20000,
  },
];

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required in .env.');
const db = createDb(process.env.DATABASE_URL);
try {
  const result = await transaction(db, async (client) => {
    const businesses = await client.query(
      'SELECT id, name FROM "Business" WHERE ($1::text IS NULL OR id = $1)',
      [process.env.SAMPLE_BUSINESS_ID || null],
    );
    if (businesses.rowCount !== 1)
      throw new Error(
        'Select one existing store using SAMPLE_BUSINESS_ID; no products were added.',
      );
    const business = businesses.rows[0];
    let added = 0;
    for (const product of samples) {
      const inserted = await client.query(
        `INSERT INTO "Product" (id, "businessId", sku, name, "priceMinor", "costMinor")
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT ("businessId", sku) DO NOTHING`,
        [
          randomUUID(),
          business.id,
          product.sku,
          product.name,
          product.priceMinor,
          product.costMinor,
        ],
      );
      added += inserted.rowCount;
    }
    return { store: business.name, added };
  });
  console.log(
    `Saved ${result.added} sample products in ${result.store}. Existing SKUs were retained.`,
  );
  console.log(
    'New products start with zero stock. Receive stock through Purchases before selling.',
  );
} finally {
  await db.end();
}
