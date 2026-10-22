import type { Db } from './db.js';
import { AppError, safeSum } from './domain.js';
function exact(value: bigint) {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER))
    throw new AppError(400, 'Chart amount exceeds the supported exact range');
  return Number(value);
}
export async function salesAnalytics(db: Db, businessId: string, days: 7 | 30, now = new Date()) {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Colombo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  const midnight = new Date(`${today}T00:00:00+05:30`);
  const from = new Date(midnight.getTime() - (days - 1) * 86400000);
  const until = new Date(midnight.getTime() + 86400000);
  return db.$transaction(
    async (tx) => {
      const [sales, refunds, top] = await Promise.all([
        tx.$queryRaw<
          { day: string; total: bigint; count: bigint }[]
        >`SELECT to_char("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Colombo', 'YYYY-MM-DD') AS day, SUM("totalMinor")::bigint AS total, COUNT(*)::bigint AS count FROM "Sale" WHERE "businessId" = ${businessId} AND "createdAt" >= ${from} AND "createdAt" < ${until} GROUP BY day ORDER BY day`,
        tx.$queryRaw<
          { day: string; total: bigint }[]
        >`SELECT to_char("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Colombo', 'YYYY-MM-DD') AS day, SUM("totalMinor")::bigint AS total FROM "Refund" WHERE "businessId" = ${businessId} AND "createdAt" >= ${from} AND "createdAt" < ${until} GROUP BY day ORDER BY day`,
        tx.$queryRaw<
          { productId: string; name: string; units: bigint; revenue: bigint }[]
        >`SELECT l."productId", (array_agg(l.name ORDER BY s."createdAt" DESC, l.id DESC))[1] AS name, SUM(l.quantity)::bigint AS units, SUM(l.quantity::bigint * l."priceMinor")::bigint AS revenue FROM "SaleLine" l JOIN "Sale" s ON s.id = l."saleId" AND s."businessId" = l."businessId" WHERE s."businessId" = ${businessId} AND s."createdAt" >= ${from} AND s."createdAt" < ${until} GROUP BY l."productId" ORDER BY units DESC, revenue DESC, l."productId" ASC LIMIT 5`,
      ]);
      const daily = Array.from({ length: days }, (_, index) => {
        const day = new Date(from.getTime() + index * 86400000 + 19800000)
          .toISOString()
          .slice(0, 10);
        const sale = sales.find((row) => row.day === day),
          returned = refunds.find((row) => row.day === day);
        const grossMinor = exact(sale?.total ?? 0n),
          refundMinor = exact(returned?.total ?? 0n);
        return {
          date: day,
          grossMinor,
          refundMinor,
          netMinor: safeSum([grossMinor, -refundMinor]),
          transactions: exact(sale?.count ?? 0n),
        };
      });
      return {
        days,
        from: daily[0]!.date,
        to: today,
        daily,
        summary: {
          grossMinor: safeSum(daily.map((row) => row.grossMinor)),
          refundMinor: safeSum(daily.map((row) => row.refundMinor)),
          netMinor: safeSum(daily.map((row) => row.netMinor)),
          transactions: safeSum(daily.map((row) => row.transactions)),
        },
        topProducts: top.map((row) => ({
          productId: row.productId,
          name: row.name,
          units: exact(row.units),
          revenueMinor: exact(row.revenue),
        })),
      };
    },
    { isolationLevel: 'RepeatableRead' },
  );
}
