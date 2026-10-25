import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createDb } from './db.js';

export async function migrate(db) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('shopflow-schema'))");
    await client.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP)',
    );
    const files = (await readdir(new URL('../db/', import.meta.url)))
      .filter((name) => /^\d+.*\.sql$/.test(name))
      .sort();
    for (const name of files) {
      const sql = await readFile(new URL('../db/' + name, import.meta.url), 'utf8');
      const checksum = createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex');
      const recorded = await client.query(
        'SELECT checksum FROM schema_migrations WHERE name = $1',
        [name],
      );
      if (recorded.rows[0]) {
        if (recorded.rows[0].checksum !== checksum)
          throw new Error('An applied SQL migration was modified: ' + name);
        continue;
      }
      const existing = await client.query('SELECT to_regclass(\'public."Business"\') AS name');
      if (name === '001-initial.sql' && existing.rows[0].name) {
        // Recognize the same table structure without changing existing store records.
        const tables = {
          Business: ['id', 'name', 'createdAt'],
          User: [
            'id',
            'businessId',
            'email',
            'name',
            'passwordHash',
            'role',
            'active',
            'createdAt',
          ],
          Session: ['id', 'userId', 'csrf', 'expiresAt'],
          Category: ['id', 'businessId', 'name'],
          Supplier: ['id', 'businessId', 'name', 'contact'],
          Product: [
            'id',
            'businessId',
            'sku',
            'name',
            'priceMinor',
            'costMinor',
            'stock',
            'active',
            'categoryId',
          ],
          Purchase: [
            'id',
            'businessId',
            'supplierId',
            'requestKey',
            'requestHash',
            'totalMinor',
            'createdAt',
          ],
          PurchaseLine: ['id', 'businessId', 'purchaseId', 'productId', 'quantity', 'costMinor'],
          Sale: [
            'id',
            'businessId',
            'invoiceNo',
            'requestKey',
            'requestHash',
            'cashierId',
            'totalMinor',
            'paidMinor',
            'createdAt',
          ],
          SaleLine: [
            'id',
            'businessId',
            'saleId',
            'productId',
            'sku',
            'name',
            'quantity',
            'priceMinor',
            'costMinor',
          ],
        };
        for (const [table, columns] of Object.entries(tables)) {
          await client.query(
            `SELECT ${columns.map((column) => '"' + column + '"').join(', ')} FROM "${table}" LIMIT 0`,
          );
        }
      } else await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [
        name,
        checksum,
      ]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL before applying migrations.');
  const db = createDb(process.env.DATABASE_URL);
  try {
    await migrate(db);
    console.log('Database migrations applied.');
  } finally {
    await db.end();
  }
}
