import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import pg from 'pg';
import { drizzle as drizzlePg, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { env } from '../env.js';
import * as schema from './schema.js';

export type DB = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<DB['transaction']>[0]>[0];
export type Executor = DB | Tx;

interface Handle {
  db: DB;
  driver: 'pg' | 'pglite';
  execRaw: (sqlText: string) => Promise<void>;
  close: () => Promise<void>;
}

let handle: Handle | null = null;

/**
 * DATABASE_URL = postgres://…  → node-postgres Pool (Neon: use the -pooler host).
 * DATABASE_URL unset           → embedded PGlite persisted in .data/pglite.
 * DATABASE_URL = pglite://memory → in-memory PGlite (tests).
 */
export async function initDb(url: string | undefined = env.DATABASE_URL): Promise<DB> {
  if (handle) return handle.db;

  if (url && /^postgres(ql)?:\/\//.test(url)) {
    const pool = new pg.Pool({
      connectionString: url,
      max: env.DB_POOL_MAX,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
    pool.on('error', (err) => console.error('[db] idle client error', err.message));
    handle = {
      db: drizzlePg(pool, { schema }),
      driver: 'pg',
      execRaw: async (text) => {
        await pool.query(text);
      },
      close: () => pool.end(),
    };
    return handle.db;
  }

  // Everything PGlite-related is imported lazily: the Vercel bundle ships without it, and
  // drizzle-orm/pglite imports @electric-sql/pglite at load time.
  const { drizzle: drizzlePglite } = await import('drizzle-orm/pglite');
  const { PGlite } = await import('@electric-sql/pglite');
  const { btree_gist } = await import('@electric-sql/pglite/contrib/btree_gist');
  const { pg_trgm } = await import('@electric-sql/pglite/contrib/pg_trgm');
  const target = url?.startsWith('pglite://') ? url.slice('pglite://'.length) : '.data/pglite';
  if (target !== 'memory') mkdirSync(dirname(target), { recursive: true });
  const client = new PGlite({
    dataDir: target === 'memory' ? undefined : target,
    extensions: { btree_gist, pg_trgm },
  });
  await client.waitReady;
  handle = {
    db: drizzlePglite(client, { schema }) as unknown as DB,
    driver: 'pglite',
    execRaw: async (text) => {
      await client.exec(text);
    },
    close: () => client.close(),
  };
  return handle.db;
}

function current(): Handle {
  if (!handle) throw new Error('Database not initialised: call initDb() first');
  return handle;
}

export const db = (): DB => current().db;
export const dbDriver = () => current().driver;
export const execRaw = (sqlText: string) => current().execRaw(sqlText);

export async function closeDb() {
  if (!handle) return;
  const h = handle;
  handle = null;
  await h.close();
}
