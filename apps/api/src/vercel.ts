// Vercel Function entry: the same Express app, started lazily once per instance.
// Vercel serves the built site from its CDN; only /api/* reaches this function.
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Express } from 'express';
import { createApp } from './app.js';
import { initDb } from './db/client.js';
import { migrate } from './db/migrate.js';
import { seedIfEmpty } from './db/seed.js';
import { env } from './env.js';
import { sweepExpiredHolds } from './services/booking.service.js';

let ready: Promise<Express> | null = null;

function boot(): Promise<Express> {
  if (!env.DATABASE_URL && !env.ALLOW_EMBEDDED_DB) {
    throw new Error('DATABASE_URL is not set — add your Neon connection string in Vercel → Settings → Environment Variables');
  }
  return (async () => {
    await initDb();
    await migrate(() => {}); // a no-op SELECT once the schema is current
    if (env.SEED_ON_BOOT) await seedIfEmpty();
    return createApp();
  })();
}

// There is no long-running process for the 60 s sweeper. Expired holds are already
// reclaimable inline, so this is only tidy-up: piggyback on traffic at most once a minute.
let lastSweep = 0;
function maybeSweep() {
  if (Date.now() - lastSweep < 60_000) return;
  lastSweep = Date.now();
  sweepExpiredHolds().catch((err) => console.error('[sweeper]', err));
}

/** The route rewrite passes the original path as ?__path=…; put it back for Express. */
function restorePath(req: IncomingMessage) {
  const url = new URL(req.url ?? '/', 'http://x');
  const path = url.searchParams.get('__path');
  if (path === null) return;
  url.searchParams.delete('__path');
  req.url = `/api/${path}${url.search}`;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    ready ??= boot();
    const app = await ready;
    maybeSweep();
    restorePath(req);
    app(req as Parameters<Express>[0], res as Parameters<Express>[1]);
  } catch (err) {
    ready = null; // retry the boot on the next request (e.g. Neon was waking up)
    console.error('[boot]', err);
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: { code: 'BOOT_FAILED', message: 'Service is starting up, please retry', details: {} } }));
  }
}
