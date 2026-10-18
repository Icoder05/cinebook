import { createServer } from 'node:net';
import { createApp, webDistAvailable } from './app.js';
import { closeDb, dbDriver, initDb } from './db/client.js';
import { migrate } from './db/migrate.js';
import { seedIfEmpty } from './db/seed.js';
import { env } from './env.js';
import { startSweeper } from './jobs/sweeper.js';

// Check the port BEFORE opening the database: a second copy of the app (e.g. `npm start`
// while `npm run dev` is running) must not open the same embedded database files.
const portFree = await new Promise<boolean>((done) => {
  const probe = createServer()
    .once('error', () => done(false))
    .once('listening', () => probe.close(() => done(true)))
    .listen(env.PORT);
});
if (!portFree) {
  console.error(
    `\n  Port ${env.PORT} is already in use — CineBook is probably already running.\n` +
      `  Open http://localhost:${env.PORT} (npm start) or http://localhost:5173 (npm run dev),\n` +
      `  or stop the other copy first.\n`,
  );
  process.exit(1);
}

await initDb();
await migrate();
if (dbDriver() === 'pglite' || env.SEED_ON_BOOT) {
  // Zero-setup: an empty database gets demo data automatically.
  await seedIfEmpty();
}
if (env.NODE_ENV === 'production' && dbDriver() === 'pglite') {
  console.warn('[api] WARNING: running on the embedded database — data resets on every redeploy/restart.');
}

const app = createApp();
const server = app.listen(env.PORT, () => {
  const api = `http://localhost:${env.PORT}/api/v1`;
  const site = webDistAvailable() ? `http://localhost:${env.PORT}` : env.WEB_URL;
  console.log(
    [
      '',
      `  CineBook is running  (db: ${dbDriver()})`,
      `  ➜ Open the app:  ${site}`,
      `  ➜ API:           ${api}`,
      '',
    ].join('\n'),
  );
});
const stopSweeper = startSweeper(env.SWEEPER_INTERVAL_MS);

async function shutdown(signal: string) {
  console.log(`[api] ${signal} received, shutting down`);
  stopSweeper();
  server.close();
  await closeDb();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
