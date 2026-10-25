import { z } from 'zod';
import { createDb } from './db.js';
import { buildApp } from './app.js';

const env = z
  .object({
    DATABASE_URL: z.string().url(),
    APP_ORIGIN: z.string().url(),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    HOST: z.string().default('127.0.0.1'),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    SESSION_DAYS: z.coerce.number().int().min(1).max(30).default(7),
  })
  .parse(process.env);
if (env.NODE_ENV === 'production' && !env.APP_ORIGIN.startsWith('https://'))
  throw new Error('Production requires an HTTPS APP_ORIGIN');
const db = createDb(env.DATABASE_URL);
const app = buildApp(db, {
  origin: env.APP_ORIGIN,
  production: env.NODE_ENV === 'production',
  logger: true,
  sessionDays: env.SESSION_DAYS,
});
const server = app.listen(env.PORT, env.HOST, () =>
  console.log(`ShopFlow API ready at http://${env.HOST}:${env.PORT}`),
);
server.requestTimeout = 30000;
server.headersTimeout = 35000;
server.on('error', async (error) => {
  console.error('API could not start:', error.code ?? 'unknown error');
  await db.end();
  process.exitCode = 1;
});
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    server.close(async () => {
      await db.end();
      process.exit(0);
    });
  });
