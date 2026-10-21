import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url);
config({ path: fileURLToPath(new URL('.env', root)), quiet: true });
process.env.PORT = process.env.WEB_PORT ?? '3000';
// Load configuration before Next creates its development worker.
await import(new URL('node_modules/next/dist/bin/next', root).href);
