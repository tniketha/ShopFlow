import { Pool, types, defaults } from 'pg';

// The schema stores UTC timestamps without an offset.
defaults.parseInputDatesAsUTC = true;
types.setTypeParser(1114, (value) => new Date(value.replace(' ', 'T') + 'Z'));

export function createDb(url) {
  const pool = new Pool({
    connectionString: url,
    max: 10,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    statement_timeout: 10000,
    options: '-c timezone=UTC',
  });
  pool.on('error', () => console.error('An idle database connection failed.'));
  return pool;
}

export async function transaction(pool, work, isolation = 'SERIALIZABLE') {
  if (!['SERIALIZABLE', 'REPEATABLE READ'].includes(isolation))
    throw new Error('Unsupported transaction isolation');
  for (let attempt = 0; attempt < 5; attempt++) {
    const client = await pool.connect();
    try {
      await client.query(`BEGIN ISOLATION LEVEL ${isolation}`);
      await client.query("SET LOCAL idle_in_transaction_session_timeout = '15s'");
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      if (!['40001', '40P01', '23505'].includes(error.code) || attempt === 4) throw error;
    } finally {
      client.release();
    }
    await new Promise((done) => setTimeout(done, 20 * (attempt + 1)));
  }
}

export async function findSale(client, businessId, requestKey) {
  const { rows } = await client.query(
    'SELECT * FROM "Sale" WHERE "businessId" = $1 AND "requestKey" = $2',
    [businessId, requestKey],
  );
  if (!rows[0]) return null;
  const lines = await client.query(
    'SELECT * FROM "SaleLine" WHERE "businessId" = $1 AND "saleId" = $2 ORDER BY id',
    [businessId, rows[0].id],
  );
  return { ...rows[0], lines: lines.rows };
}

export async function findPurchase(client, businessId, requestKey) {
  const { rows } = await client.query(
    'SELECT * FROM "Purchase" WHERE "businessId" = $1 AND "requestKey" = $2',
    [businessId, requestKey],
  );
  if (!rows[0]) return null;
  const lines = await client.query(
    'SELECT * FROM "PurchaseLine" WHERE "businessId" = $1 AND "purchaseId" = $2 ORDER BY id',
    [businessId, rows[0].id],
  );
  return { ...rows[0], lines: lines.rows };
}
