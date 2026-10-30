// E10: database optimisation on Neon — indexes, normalisation and write cost.
//   node experiments/harness/db-optim.mjs [--run name] [--keep]
// Builds a synthetic copy of CineBook's hot tables in a separate schema (research_e10),
// sized like a busy city (5,000 showtimes × 200 seats = 1 M show_seats rows, 200 k bookings),
// times each query variant with EXPLAIN (ANALYZE, BUFFERS) — server-side time, no network —
// and drops the schema afterwards. Live CineBook tables are never touched.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { createLogger } from './log.mjs';
import { CONFIG, ROOT } from './paths.mjs';
import { mulberry32 } from './stats.mjs';

const require = createRequire(import.meta.url);
const pg = require('pg');
const config = JSON.parse(readFileSync(CONFIG, 'utf8'));
const E = config.offline.E10;
const args = process.argv.slice(2);
const RUN_ID = args.includes('--run') ? args[args.indexOf('--run') + 1] : 'db-optim';
const S = 'research_e10';
const WARMUP = 3;
const rnd = mulberry32(config.seed + 10);
const log = createLogger(RUN_ID);
const url = readFileSync(resolve(ROOT, 'apps/api/.env'), 'utf8').split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL=')).slice(13).trim();
const db = new pg.Client({ connectionString: url });

const q = (text, params) => db.query(text, params);
const uuidOf = (prefix, n) => `${prefix}${n.toString(16).padStart(12, '0')}`; // deterministic UUIDs
const showId = (n) => uuidOf('00000000-0000-4000-8000-', n);
const userId = (n) => uuidOf('00000000-0000-4000-9000-', n);
const sizeOf = async (rel) => (await q(`SELECT pg_relation_size('${S}.${rel}')::bigint AS b`)).rows[0].b / 1024 / 1024;
const tableSize = async (rel) => (await q(`SELECT pg_total_relation_size('${S}.${rel}')::bigint AS b`)).rows[0].b / 1024 / 1024;

async function explain(sql, params, { rollback = false } = {}) {
  if (rollback) await q('BEGIN');
  const t0 = performance.now();
  const r = await q(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`, params);
  const wall = performance.now() - t0;
  if (rollback) await q('ROLLBACK');
  const plan = r.rows[0]['QUERY PLAN'][0];
  const nodes = [];
  (function walk(n) { nodes.push(n['Node Type'] + (n['Index Name'] ? `:${n['Index Name']}` : '')); (n.Plans ?? []).forEach(walk); })(plan.Plan);
  return {
    execMs: plan['Execution Time'], planMs: plan['Planning Time'], wallMs: wall,
    sharedHit: plan.Plan['Shared Hit Blocks'] ?? 0, sharedRead: plan.Plan['Shared Read Blocks'] ?? 0, plan: nodes.join(' > '),
  };
}

async function measure(query, variant, sql, paramFn, opts) {
  for (let i = 0; i < E.repsPerQuery + WARMUP; i++) {
    const m = await explain(sql, paramFn(), opts);
    if (i < WARMUP) continue;
    log.op({ exp: 'E10', strategy: `${query} | ${variant}`, query, variant, c: 1, trial: i - WARMUP, latencyMs: +m.execMs.toFixed(3), planMs: +m.planMs.toFixed(3), wallMs: +m.wallMs.toFixed(1), sharedHit: m.sharedHit, sharedRead: m.sharedRead, plan: m.plan, outcome: 'success' });
  }
  const last = await explain(sql, paramFn(), opts);
  console.log(`${query.padEnd(18)} ${variant.padEnd(26)} ${last.execMs.toFixed(2).padStart(9)} ms  ${last.plan.slice(0, 70)}`);
}

async function main() {
  await db.connect();
  const manifest = { runId: RUN_ID, startedAt: new Date().toISOString(), design: E, warmup: WARMUP, server: (await q('SELECT version()')).rows[0].version };
  log.manifest(manifest);
  log.event({ type: 'run_start', runId: RUN_ID, totalCells: 6 });

  // ---- synthetic data ---------------------------------------------------------------
  console.log('building synthetic dataset…');
  await q(`DROP SCHEMA IF EXISTS ${S} CASCADE`);
  await q(`CREATE SCHEMA ${S}`);
  const nShows = E.showtimes;
  const nSeats = E.seatsPerShowtime;
  const nScreens = 250;
  await q(`CREATE TABLE ${S}.seat_tiers (id int PRIMARY KEY, screen_id int NOT NULL, name text NOT NULL, base_price_paise int NOT NULL)`);
  await q(`INSERT INTO ${S}.seat_tiers SELECT s*3+t, s, (ARRAY['Recliner','Prime','Classic'])[t+1], (ARRAY[45000,30000,18000])[t+1] FROM generate_series(0,${nScreens - 1}) s, generate_series(0,2) t`);
  await q(`CREATE TABLE ${S}.seats (id int PRIMARY KEY, screen_id int NOT NULL, row_label text NOT NULL, col_no int NOT NULL, tier_id int NOT NULL)`);
  await q(`INSERT INTO ${S}.seats SELECT s*${nSeats}+k, s, chr(65 + k/20), k%20+1, s*3 + CASE WHEN k<40 THEN 0 WHEN k<120 THEN 1 ELSE 2 END
           FROM generate_series(0,${nScreens - 1}) s, generate_series(0,${nSeats - 1}) k`);
  await q(`CREATE TABLE ${S}.showtimes (id uuid PRIMARY KEY, screen_id int NOT NULL)`);
  await q(`INSERT INTO ${S}.showtimes SELECT ('00000000-0000-4000-8000-'||lpad(to_hex(n),12,'0'))::uuid, n % ${nScreens} FROM generate_series(0,${nShows - 1}) n`);
  // show_seats: built in random physical order so "no index" really means scanning.
  await q(`CREATE TABLE ${S}.show_seats (showtime_id uuid NOT NULL, seat_id int NOT NULL, status text NOT NULL, held_by uuid,
           hold_expires_at timestamptz, booking_id uuid, version int NOT NULL DEFAULT 0)`);
  await q(`SELECT setseed(0.2026)`);
  await q(`INSERT INTO ${S}.show_seats
           SELECT st.id, (st.screen_id*${nSeats}+k), x.status,
                  CASE WHEN x.status='HELD' THEN ('00000000-0000-4000-9000-'||lpad(to_hex((random()*49999)::int),12,'0'))::uuid END,
                  CASE WHEN x.status='HELD' THEN now() + (random()*20-10) * interval '1 minute' END, NULL, 0
           FROM ${S}.showtimes st, generate_series(0,${nSeats - 1}) k,
                LATERAL (SELECT CASE WHEN r < 0.85 THEN 'AVAILABLE' WHEN r < 0.88 THEN 'HELD' ELSE 'BOOKED' END AS status FROM (SELECT random() + k*0 AS r) z) x
           ORDER BY random()`);
  await q(`CREATE TABLE ${S}.bookings (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, showtime_id uuid NOT NULL, status text NOT NULL, created_at timestamptz NOT NULL)`);
  await q(`INSERT INTO ${S}.bookings (user_id, showtime_id, status, created_at)
           SELECT ('00000000-0000-4000-9000-'||lpad(to_hex((random()*49999)::int),12,'0'))::uuid,
                  ('00000000-0000-4000-8000-'||lpad(to_hex((random()*${nShows - 1})::int),12,'0'))::uuid,
                  CASE WHEN random()<0.8 THEN 'CONFIRMED' ELSE 'CANCELLED' END, now() - random()*interval '180 days'
           FROM generate_series(1,${E.bookings}) ORDER BY random()`);
  await q(`ANALYZE ${S}.show_seats; ANALYZE ${S}.bookings; ANALYZE ${S}.seats; ANALYZE ${S}.seat_tiers`);
  const counts = (await q(`SELECT (SELECT count(*) FROM ${S}.show_seats)::int ss, (SELECT count(*) FROM ${S}.bookings)::int b,
    (SELECT count(*) FROM ${S}.show_seats WHERE status='HELD')::int held, (SELECT count(*) FROM ${S}.show_seats WHERE status='HELD' AND hold_expires_at < now())::int expired`)).rows[0];
  log.event({ type: 'dataset', ...counts, heapMB: await sizeOf('show_seats') });
  console.log('dataset', counts);

  const randShow = () => showId(Math.floor(rnd() * nShows));
  const randUser = () => userId(Math.floor(rnd() * 50000));
  const sizes = [];
  const recordSize = async (what, rel) => { const mb = await sizeOf(rel); sizes.push({ what, mb }); log.trial({ exp: 'E10-size', strategy: what, trial: 0, sizeMB: +mb.toFixed(2) }); };
  await recordSize('show_seats heap', 'show_seats');

  // ---- Q1/Q2: seat map read + conditional-UPDATE hold, without vs with the PK ---------------
  log.event({ type: 'cell_start', exp: 'E10', strategy: 'seat map / hold', c: 1 });
  const seatMap = `SELECT seat_id, status, hold_expires_at FROM ${S}.show_seats WHERE showtime_id = $1`;
  const holdSql = `UPDATE ${S}.show_seats SET status='HELD', held_by=$3, hold_expires_at=now()+interval '10 minutes', version=version+1
                   WHERE showtime_id=$1 AND seat_id = ANY($2::int[]) AND (status='AVAILABLE' OR (status='HELD' AND hold_expires_at < now()))`;
  const holdParams = () => {
    const n = Math.floor(rnd() * nShows);
    const base = (n % nScreens) * nSeats;
    return [showId(n), [base + Math.floor(rnd() * 100), base + 100 + Math.floor(rnd() * 100)], randUser()];
  };
  await measure('seat map', 'no index (seq scan)', seatMap, () => [randShow()]);
  await measure('hold (2 seats)', 'no index (seq scan)', holdSql, holdParams, { rollback: true });
  await q(`ALTER TABLE ${S}.show_seats ADD PRIMARY KEY (showtime_id, seat_id)`);
  await q(`ANALYZE ${S}.show_seats`);
  await recordSize('PK (showtime_id, seat_id)', 'show_seats_pkey');
  await measure('seat map', 'PK (showtime_id, seat_id)', seatMap, () => [randShow()]);
  await measure('hold (2 seats)', 'PK (showtime_id, seat_id)', holdSql, holdParams, { rollback: true });
  log.event({ type: 'progress', done: 1, total: 6 });

  // ---- Q3: expiry sweep -------------------------------------------------------------
  log.event({ type: 'cell_start', exp: 'E10', strategy: 'expiry sweep', c: 1 });
  const sweep = `UPDATE ${S}.show_seats SET status='AVAILABLE', held_by=NULL, hold_expires_at=NULL WHERE status='HELD' AND hold_expires_at < now()`;
  await measure('expiry sweep', 'no index', sweep, () => [], { rollback: true });
  await q(`CREATE INDEX ss_exp_full ON ${S}.show_seats (hold_expires_at)`);
  await q(`ANALYZE ${S}.show_seats`);
  await recordSize('full index (hold_expires_at)', 'ss_exp_full');
  await measure('expiry sweep', 'full index', sweep, () => [], { rollback: true });
  await q(`DROP INDEX ${S}.ss_exp_full`);
  await q(`CREATE INDEX ss_exp_partial ON ${S}.show_seats (hold_expires_at) WHERE status = 'HELD'`);
  await q(`ANALYZE ${S}.show_seats`);
  await recordSize("partial index WHERE status='HELD'", 'ss_exp_partial');
  await measure('expiry sweep', "partial index (HELD only)", sweep, () => [], { rollback: true });
  log.event({ type: 'progress', done: 2, total: 6 });

  // ---- Q4: My Bookings --------------------------------------------------------------
  log.event({ type: 'cell_start', exp: 'E10', strategy: 'my bookings', c: 1 });
  const mine = `SELECT id, showtime_id, status, created_at FROM ${S}.bookings WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20`;
  await measure('my bookings', 'no index', mine, () => [randUser()]);
  await q(`CREATE INDEX b_user ON ${S}.bookings (user_id)`);
  await q(`ANALYZE ${S}.bookings`);
  await recordSize('bookings (user_id)', 'b_user');
  await measure('my bookings', 'index (user_id)', mine, () => [randUser()]);
  await q(`DROP INDEX ${S}.b_user`);
  await q(`CREATE INDEX b_user_created ON ${S}.bookings (user_id, created_at DESC)`);
  await q(`ANALYZE ${S}.bookings`);
  await recordSize('bookings (user_id, created_at DESC)', 'b_user_created');
  await measure('my bookings', 'composite (user_id, created_at)', mine, () => [randUser()]);
  log.event({ type: 'progress', done: 3, total: 6 });

  // ---- Q5: normalised vs denormalised seat map ---------------------------------------
  log.event({ type: 'cell_start', exp: 'E10', strategy: 'normalisation', c: 1 });
  const norm = `SELECT ss.seat_id, ss.status, s.row_label, s.col_no, t.name, t.base_price_paise
                FROM ${S}.show_seats ss JOIN ${S}.seats s ON s.id = ss.seat_id JOIN ${S}.seat_tiers t ON t.id = s.tier_id
                WHERE ss.showtime_id = $1`;
  await measure('seat map + layout', 'normalised (3-table join)', norm, () => [randShow()]);
  await q(`CREATE TABLE ${S}.show_seats_denorm AS
           SELECT ss.*, s.row_label, s.col_no, t.name AS tier_name, t.base_price_paise FROM ${S}.show_seats ss
           JOIN ${S}.seats s ON s.id = ss.seat_id JOIN ${S}.seat_tiers t ON t.id = s.tier_id ORDER BY random()`);
  await q(`ALTER TABLE ${S}.show_seats_denorm ADD PRIMARY KEY (showtime_id, seat_id)`);
  await q(`ANALYZE ${S}.show_seats_denorm`);
  const denorm = `SELECT seat_id, status, row_label, col_no, tier_name, base_price_paise FROM ${S}.show_seats_denorm WHERE showtime_id = $1`;
  await measure('seat map + layout', 'denormalised (1 table)', denorm, () => [randShow()]);
  const nTotal = await tableSize('show_seats') + await tableSize('seats') + await tableSize('seat_tiers');
  const dTotal = await tableSize('show_seats_denorm');
  log.trial({ exp: 'E10-size', strategy: 'normalised total (incl. indexes)', trial: 0, sizeMB: +nTotal.toFixed(2) });
  log.trial({ exp: 'E10-size', strategy: 'denormalised total (incl. indexes)', trial: 0, sizeMB: +dTotal.toFixed(2) });
  // Update anomaly: a tier price change touches 3 rows normalised vs every show seat denormalised.
  await measure('tier price change', 'normalised', `UPDATE ${S}.seat_tiers SET base_price_paise = base_price_paise + 1000 WHERE screen_id = $1`, () => [Math.floor(rnd() * nScreens)], { rollback: true });
  await measure('tier price change', 'denormalised', `UPDATE ${S}.show_seats_denorm d SET base_price_paise = base_price_paise + 1000 FROM ${S}.showtimes st WHERE st.id = d.showtime_id AND st.screen_id = $1`, () => [Math.floor(rnd() * nScreens)], { rollback: true });
  await q(`DROP TABLE ${S}.show_seats_denorm`);
  log.event({ type: 'progress', done: 4, total: 6 });

  // ---- Q6: write cost of extra indexes (bulk insert of one new day's seats) ------------
  log.event({ type: 'cell_start', exp: 'E10', strategy: 'index write cost', c: 1 });
  await q(`DROP INDEX IF EXISTS ${S}.ss_exp_partial`);
  const insertDay = `INSERT INTO ${S}.show_seats (showtime_id, seat_id, status)
                     SELECT ('00000000-0000-4000-a000-'||lpad(to_hex(n),12,'0'))::uuid, k, 'AVAILABLE' FROM generate_series(0,49) n, generate_series(0,${nSeats - 1}) k`;
  await measure('insert 10k seats', 'PK only', insertDay, () => [], { rollback: true });
  await q(`CREATE INDEX ss_exp_partial ON ${S}.show_seats (hold_expires_at) WHERE status = 'HELD'`);
  await measure('insert 10k seats', 'PK + partial', insertDay, () => [], { rollback: true });
  await q(`CREATE INDEX ss_status ON ${S}.show_seats (status)`);
  await q(`CREATE INDEX ss_held_by ON ${S}.show_seats (held_by)`);
  await q(`CREATE INDEX ss_exp_full ON ${S}.show_seats (hold_expires_at)`);
  await measure('insert 10k seats', 'PK + 4 secondary', insertDay, () => [], { rollback: true });
  log.event({ type: 'progress', done: 5, total: 6 });

  // ---- transactions: cost of isolation level for the hold statement -------------------
  log.event({ type: 'cell_start', exp: 'E10', strategy: 'isolation', c: 1 });
  for (const iso of ['READ COMMITTED', 'REPEATABLE READ', 'SERIALIZABLE']) {
    for (let i = 0; i < E.repsPerQuery + WARMUP; i++) {
      const p = holdParams();
      const t0 = performance.now();
      await q(`BEGIN ISOLATION LEVEL ${iso}`);
      await q(holdSql, p);
      await q('ROLLBACK');
      if (i >= WARMUP) log.op({ exp: 'E10', strategy: `hold txn | ${iso}`, query: 'hold txn (client RTT)', variant: iso, c: 1, trial: i - WARMUP, latencyMs: +(performance.now() - t0).toFixed(2), outcome: 'success' });
    }
    console.log(`hold txn ${iso} done`);
  }
  log.event({ type: 'progress', done: 6, total: 6 });

  if (!args.includes('--keep')) await q(`DROP SCHEMA ${S} CASCADE`);
  log.event({ type: 'cleanup', dropped: !args.includes('--keep') });
  console.table(sizes);
  manifest.finishedAt = new Date().toISOString();
  log.manifest(manifest);
  log.event({ type: 'run_end', finishedAt: manifest.finishedAt });
  await db.end();
  await log.close();
}

main().catch(async (e) => {
  console.error(e);
  try { await db.query(`DROP SCHEMA IF EXISTS ${S} CASCADE`); } catch { /* ignore */ }
  await log.close();
  process.exit(1);
});
