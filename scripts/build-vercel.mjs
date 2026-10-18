// Builds the app for Vercel using the Build Output API (https://vercel.com/docs/build-output-api):
//   .vercel/output/static            ← the React site (served from Vercel's CDN)
//   .vercel/output/functions/api.func ← the whole Express API bundled into one file
//   .vercel/output/config.json       ← /api/* → function, everything else → the SPA
import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, '.vercel/output');
const fn = resolve(out, 'functions/api.func');
const region = process.env.CINEBOOK_REGION || 'sin1'; // keep it next to the Neon region

rmSync(out, { recursive: true, force: true });

console.log('› building web');
execSync('npm run build -w @cinebook/web', { cwd: root, stdio: 'inherit' });
cpSync(resolve(root, 'apps/web/dist'), resolve(out, 'static'), { recursive: true });

console.log('› bundling API function');
mkdirSync(fn, { recursive: true });
await build({
  entryPoints: [resolve(root, 'apps/api/src/vercel.ts')],
  outfile: resolve(fn, 'index.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  // PGlite is only for local dev (never loaded when DATABASE_URL is set); pg-native is optional.
  external: ['@electric-sql/pglite', '@electric-sql/pglite/*', 'pg-native'],
  // CommonJS dependencies call require(); give the ESM bundle a real one.
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
  logLevel: 'warning',
});
writeFileSync(
  resolve(fn, '.vc-config.json'),
  JSON.stringify(
    {
      runtime: 'nodejs22.x',
      handler: 'index.mjs',
      launcherType: 'Nodejs',
      shouldAddHelpers: false,
      shouldAddSourcemapSupport: true,
      maxDuration: 60,
      regions: [region],
      environment: { DB_POOL_MAX: '3', SWEEPER_INTERVAL_MS: '0' },
    },
    null,
    2,
  ),
);

writeFileSync(
  resolve(out, 'config.json'),
  JSON.stringify(
    {
      version: 3,
      routes: [
        { src: '^/assets/(.*)$', headers: { 'cache-control': 'public, max-age=31536000, immutable' }, continue: true },
        // Carry the original path in __path so the handler can restore it (see vercel.ts).
        { src: '^/api/(.*)$', dest: '/api?__path=$1' },
        { handle: 'filesystem' },
        { src: '^/.*$', dest: '/index.html' },
      ],
    },
    null,
    2,
  ),
);
console.log(`› done: .vercel/output (function region ${region})`);
