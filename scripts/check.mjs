import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

async function check(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) await check(path);
    else if (/\.m?js$/.test(entry.name)) {
      const result = spawnSync(process.execPath, ['--check', path], {
        stdio: 'inherit',
        windowsHide: true,
      });
      if (result.status !== 0) process.exit(result.status ?? 1);
    }
  }
}
await check('backend/src');
await check('backend/test');
await check('scripts');
console.log('JavaScript syntax checks passed. Frontend JSX is checked by the production build.');
