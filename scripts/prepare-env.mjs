import { existsSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
if (!existsSync('.env')) {
  const password = randomBytes(24).toString('hex');
  writeFileSync(
    '.env',
    `DATABASE_URL=postgresql://shopflow:${password}@127.0.0.1:54329/shopflow\nAPP_ORIGIN=http://localhost:3000\nAPI_INTERNAL_URL=http://127.0.0.1:4000\nPORT=4000\nHOST=127.0.0.1\nNODE_ENV=development\nSESSION_DAYS=7\n`,
    { flag: 'wx' },
  );
  console.log('Created a local environment file with a random database password.');
} else console.log('Keeping the existing environment file.');
