import { sql } from 'drizzle-orm';
import { db, execRaw } from './client.js';
import init from './migrations/0001_init.js';
import ticketCheckin from './migrations/0002_ticket_checkin.js';

const migrations: { name: string; sql: string }[] = [
  { name: '0001_init', sql: init },
  { name: '0002_ticket_checkin', sql: ticketCheckin },
];

export async function migrate(log = console.log) {
  await execRaw(`CREATE TABLE IF NOT EXISTS _migrations (
    name text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  const res = await db().execute<{ name: string }>(sql`SELECT name FROM _migrations`);
  const applied = new Set(res.rows.map((r) => r.name));
  for (const m of migrations) {
    if (applied.has(m.name)) continue;
    // One simple-protocol round trip: the whole migration commits or none of it does.
    await execRaw(`BEGIN;\n${m.sql}\nINSERT INTO _migrations (name) VALUES ('${m.name}');\nCOMMIT;`);
    log(`[migrate] applied ${m.name}`);
  }
}

export async function dropAll() {
  await execRaw('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
}
