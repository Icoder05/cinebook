// Vercel Function entry: the same Express app, started lazily once per instance.
// Vercel serves the built site from its CDN; only /api/* reaches this function.
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Express } from 'express';
import { createApp } from './app.js';
import { initDb } from './db/client.js';
import { migrate } from './db/migrate.js';
import { seedIfEmpty } from './db/seed.js';
import { describeDatabaseUrl, env, envProblems } from './env.js';
import { sweepExpiredHolds } from './services/booking.service.js';

let ready: Promise<Express> | null = null;

/** A setup mistake we can explain safely to whoever opens the site (names only, no values). */
class ConfigError extends Error {}

function boot(): Promise<Express> {
  if (envProblems.length) {
    throw new ConfigError(`Vercel environment variables need fixing: ${envProblems.join('; ')}`);
  }
  if (!env.DATABASE_URL && !env.ALLOW_EMBEDDED_DB) {
    throw new ConfigError('DATABASE_URL is not set — add your Neon connection string in Vercel → Settings → Environment Variables');
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
    const config = err instanceof ConfigError;
    // Database errors (auth failed, host not found, timeout…) carry no secrets — show them.
    let reason = err instanceof Error ? err.message : String(err);
    if (/invalid url/i.test(reason)) {
      reason += ` — check DATABASE_URL in Vercel (${describeDatabaseUrl(env.DATABASE_URL)})`;
    }
    res.statusCode = config ? 500 : 503;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.end(
      JSON.stringify({
        error: {
          code: config ? 'CONFIG_ERROR' : 'DB_UNAVAILABLE',
          message: config ? reason : `Could not connect to the database: ${reason}`,
          details: {},
        },
      }),
    );
  }
}
