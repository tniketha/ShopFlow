import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client.js';
export function createDb(url: string) {
  return new PrismaClient({
    adapter: new PrismaPg({
      connectionString: url,
      max: 10,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30000,
      statement_timeout: 10000,
    }),
  });
}
export type Db = ReturnType<typeof createDb>;
export type Tx = Parameters<Parameters<Db['$transaction']>[0]>[0];
export async function atomic<T>(db: Db, work: (tx: Tx) => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await db.$transaction(work, { isolationLevel: 'Serializable', timeout: 15_000 });
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (!['P2034', 'P2002'].includes(code ?? '') || attempt === 4) throw error;
      await new Promise((resolve) => setTimeout(resolve, 20 * (attempt + 1)));
    }
  }
  throw new Error('Transaction retry exhausted');
}
