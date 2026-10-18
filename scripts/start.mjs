// `npm start`: run the built app — website + API — as ONE server on one link.
// (`npm run build` runs first; see package.json.)
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const server = resolve(root, 'apps/api/dist/server.js');
if (!existsSync(server) || !existsSync(resolve(root, 'apps/web/dist/index.html'))) {
  console.error('Build output missing — run `npm run build` first (npm start does this for you).');
  process.exit(1);
}

process.env.SERVE_WEB ??= 'true';
// Same working directory as `npm run dev`, so both use apps/api/.env and apps/api/.data.
process.chdir(resolve(root, 'apps/api'));
await import(pathToFileURL(server).href);
