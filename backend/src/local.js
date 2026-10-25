import { config } from 'dotenv';
import { LocalPostgres } from './postgres.js';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
const root = resolve(fileURLToPath(new URL('../../', import.meta.url)));
config({ path: resolve(root, '.env'), quiet: true });
if (!process.env.DATABASE_URL) throw new Error('Run Setup.cmd first or create .env.');
const url = new URL(process.env.DATABASE_URL);
if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/shopflow')
  throw new Error(
    'local:db is for a loopback shopflow database only. Use your PostgreSQL service for external databases.',
  );
const directory = resolve(root, 'work', 'database');
mkdirSync(resolve(root, 'work'), { recursive: true });
const pg = new LocalPostgres({
  databaseDir: directory,
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
  port: Number(url.port || 54329),
});
let stopped = false;
async function stop() {
  if (!stopped) {
    stopped = true;
    await pg.stop();
  }
}
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, async () => {
    await stop();
    process.exit(0);
  });
if (!existsSync(resolve(directory, 'PG_VERSION'))) await pg.initialise();
await pg.start();
try {
  const admin = pg.getPgClient('postgres', '127.0.0.1');
  await admin.connect();
  const result = await admin.query("SELECT 1 FROM pg_database WHERE datname = 'shopflow'");
  await admin.end();
  if (!result.rowCount) await pg.createDatabase('shopflow');
  if (process.argv[2] === 'setup') {
    async function npm(args) {
      if (!process.env.npm_execpath) throw new Error('Use npm run local:setup');
      await new Promise((resolveDone, reject) => {
        const child = spawn(process.execPath, [process.env.npm_execpath, ...args], {
          cwd: root,
          env: process.env,
          stdio: 'inherit',
        });
        child.on('error', reject);
        child.on('exit', (code) =>
          code === 0 ? resolveDone() : reject(new Error(`Setup command failed (${code})`)),
        );
      });
    }
    await npm(['run', 'db:migrate']);
    const client = pg.getPgClient('shopflow', '127.0.0.1');
    await client.connect();
    const accounts = await client.query('SELECT count(*)::int AS count FROM "User"');
    await client.end();
    if (accounts.rows[0].count === 0) await npm(['run', 'owner:create']);
    else console.log('Existing accounts retained. No owner password was changed.');
    await stop();
  } else {
    console.log(
      'Local PostgreSQL ready on 127.0.0.1:' +
        url.port +
        '. Keep this window open; Ctrl+C stops it safely.',
    );
    setInterval(() => {}, 60_000);
  }
} catch (error) {
  await stop();
  throw error;
}
