import { z } from 'zod';
import { createDb } from './db.js';
import { buildApp } from './app.js';
const env = z
  .object({
    DATABASE_URL: z.string().url(),
    APP_ORIGIN: z.string().url(),
    PORT: z.coerce.number().int().default(4000),
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
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, async () => {
    await app.close();
    await db.$disconnect();
    process.exit(0);
  });
await app.listen({ port: env.PORT, host: env.HOST });
