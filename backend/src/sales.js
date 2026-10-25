import { AppError, checkoutSchema, safeSum } from './domain.js';
import { checkout, purchaseSchema, receivePurchase } from './trading.js';
import { transaction } from './db.js';
import { pageQuery } from './catalogue.js';

function publicSale(sale) {
  return {
    id: sale.id,
    invoiceNo: sale.invoiceNo,
    totalMinor: sale.totalMinor,
    paidMinor: sale.paidMinor,
    createdAt: sale.createdAt,
    lines: sale.lines.map((line) => ({
      id: line.id,
      sku: line.sku,
      name: line.name,
      quantity: line.quantity,
      priceMinor: line.priceMinor,
    })),
  };
}

export function registerSales(app, db, { auth, manager }) {
  app.post('/purchases', auth, manager, async (request, response) => {
    response.json(await receivePurchase(db, request.identity, purchaseSchema.parse(request.body)));
  });
  app.get('/purchases', auth, manager, async (request, response) => {
    const { rows } = await db.query(
      `SELECT p.*, json_build_object('id', s.id, 'name', s.name, 'contact', s.contact) AS supplier,
       COALESCE((SELECT json_agg(l ORDER BY l.id) FROM "PurchaseLine" l WHERE l."purchaseId" = p.id AND l."businessId" = p."businessId"), '[]') AS lines
       FROM "Purchase" p JOIN "Supplier" s ON s.id = p."supplierId" AND s."businessId" = p."businessId"
       WHERE p."businessId" = $1 ORDER BY p."createdAt" DESC, p.id LIMIT 100`,
      [request.identity.businessId],
    );
    response.json(rows);
  });
  app.post('/sales', auth, async (request, response) => {
    response.json(
      publicSale(await checkout(db, request.identity, checkoutSchema.parse(request.body))),
    );
  });
  app.get('/sales', auth, async (request, response) => {
    const { page } = pageQuery.parse(request.query);
    const { rows } = await db.query(
      `SELECT s.*, COALESCE((SELECT json_agg(l ORDER BY l.id) FROM "SaleLine" l WHERE l."saleId" = s.id AND l."businessId" = s."businessId"), '[]') AS lines
       FROM "Sale" s WHERE s."businessId" = $1 ORDER BY s."createdAt" DESC, s.id LIMIT 50 OFFSET $2`,
      [request.identity.businessId, (page - 1) * 50],
    );
    response.json(rows.map(publicSale));
  });
  app.get('/dashboard', auth, async (request, response) => {
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Colombo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    const start = new Date(`${today}T00:00:00+05:30`);
    const end = new Date(start.getTime() + 86400000);
    const businessId = request.identity.businessId;
    const result = await transaction(
      db,
      async (client) => {
        const sales = await client.query(
          'SELECT COALESCE(sum("totalMinor"), 0)::text AS total, count(*)::int AS count FROM "Sale" WHERE "businessId" = $1 AND "createdAt" >= $2 AND "createdAt" < $3',
          [businessId, start, end],
        );
        const products = await client.query(
          'SELECT COALESCE(sum(stock), 0)::text AS stock, count(*)::int AS count FROM "Product" WHERE "businessId" = $1 AND active = true',
          [businessId],
        );
        const recent = await client.query(
          'SELECT id, "invoiceNo", "totalMinor", "createdAt" FROM "Sale" WHERE "businessId" = $1 ORDER BY "createdAt" DESC, id LIMIT 5',
          [businessId],
        );
        // Parse sums only after checking their exact range.
        function exact(value) {
          if (BigInt(value) > BigInt(Number.MAX_SAFE_INTEGER))
            throw new AppError(400, 'Report total exceeds the supported exact range');
          return safeSum([Number(value)]);
        }
        return {
          today,
          totalMinor: exact(sales.rows[0].total),
          saleCount: sales.rows[0].count,
          productCount: products.rows[0].count,
          stockCount: exact(products.rows[0].stock),
          recentSales: recent.rows,
        };
      },
      'REPEATABLE READ',
    );
    response.json(result);
  });
}
