// Experiment runner for E1, E2, E3 (Neon Postgres) and E5 (embedded PGlite).
//   node experiments/harness/runner.mjs                 # E1,E2,E3 on Neon (DATABASE_URL from apps/api/.env)
//   node experiments/harness/runner.mjs --exp E5        # platform comparison on PGlite
//   node experiments/harness/runner.mjs --quick         # 3 trials per cell (smoke test)
// Every event is appended to data/raw/<run>/events.jsonl (the dashboard tails it).
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createLogger } from './log.mjs';
import { CONFIG, ROOT } from './paths.mjs';
import { attempt, SCHEMA_SQL } from './strategies.mjs';
import { mulberry32, shuffle } from './stats.mjs';

const require = createRequire(import.meta.url);
const root = ROOT;
const config = JSON.parse(readFileSync(CONFIG, 'utf8'));

// ---- CLI ----------------------------------------------------------------------------
const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? dflt : args[i + 1];
};
const QUICK = args.includes('--quick');
const EXPS = opt('exp', 'E1,E2,E3').split(',').map((s) => s.trim());
const RUN_ID = opt('run', new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19));

// ---- database platforms ----------------------------------------------------------------
function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envFile = resolve(root, 'apps/api/.env');
  const line = existsSync(envFile) && readFileSync(envFile, 'utf8').split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL='));
  if (!line) throw new Error('DATABASE_URL not set (apps/api/.env)');
  return line.slice('DATABASE_URL='.length).trim();
}

async function neonPlatform(maxClients) {
  const pg = require('pg');
  const url = databaseUrl();
  const pool = new pg.Pool({ connectionString: url, max: maxClients + 2, idleTimeoutMillis: 60_000 });
  const host = new URL(url).hostname;
  return {
    name: 'neon',
    describe: { driver: 'node-postgres', host, pooled: host.includes('-pooler') },
    connect: () => pool.connect(),
    close: () => pool.end(),
  };
}

/**
 * PGlite is a single in-process connection. To give each simulated client its own
 * transaction, BEGIN acquires a global mutex released at COMMIT/ROLLBACK — i.e. the
 * platform executes transactions strictly one at a time, which is what PGlite does.
 */
async function pglitePlatform() {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();
  await db.waitReady;
  let chain = Promise.resolve();
  const client = () => {
    let release = null;
    return {
      async query(text, params) {
        const t = text.trim().toUpperCase();
        if (t.startsWith('BEGIN')) {
          let done;
          const prev = chain;
          chain = new Promise((r) => (done = r));
          await prev;
          release = done;
        }
        try {
          const r = await db.query(text, params);
          return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
        } finally {
          if ((t === 'COMMIT' || t === 'ROLLBACK') && release) {
            release();
            release = null;
          }
        }
      },
      release() {},
    };
  };
  return {
    name: 'pglite',
    describe: { driver: 'PGlite (WASM, in-process, single connection)', host: 'local', pooled: false },
    connect: async () => client(),
    close: () => db.close(),
  };
}

// ---- helpers ---------------------------------------------------------------------------
async function setupTrial(admin, trialId, seatCount) {
  await admin.query(
    'INSERT INTO research.show_seats (trial_id, seat_no) SELECT $1, s FROM generate_series(1, $2) AS s',
    [trialId, seatCount],
  );
}

async function verifyTrial(admin, trialId) {
  const claims = await admin.query(
    `SELECT seat_no, count(*)::int AS n, array_agg(client ORDER BY claimed_at) AS clients
       FROM research.claims WHERE trial_id = $1 GROUP BY seat_no`,
    [trialId],
  );
  const seats = await admin.query(
    'SELECT seat_no, status, held_by FROM research.show_seats WHERE trial_id = $1',
    [trialId],
  );
  const holder = new Map(seats.rows.map((s) => [s.seat_no, s.held_by]));
  let oversoldSeats = 0;
  let doubleBookings = 0;
  let lostUpdates = 0;
  for (const c of claims.rows) {
    if (c.n > 1) {
      oversoldSeats++;
      doubleBookings += c.n - 1;
      // Every claimant except the final holder believes they own a seat they don't.
      lostUpdates += c.clients.filter((x) => x !== holder.get(c.seat_no)).length;
    }
  }
  return { oversoldSeats, doubleBookings, lostUpdates, claimedSeats: claims.rows.length };
}

async function pgStats(admin, platform) {
  if (platform !== 'neon') return null;
  const r = await admin.query(
    `SELECT xact_commit::bigint AS commits, xact_rollback::bigint AS rollbacks, deadlocks::bigint AS deadlocks,
            tup_updated::bigint AS updated, tup_inserted::bigint AS inserted
       FROM pg_stat_database WHERE datname = current_database()`,
  );
  const row = r.rows[0];
  return Object.fromEntries(Object.entries(row).map(([k, v]) => [k, Number(v)]));
}

const diff = (a, b) => (a && b ? Object.fromEntries(Object.keys(a).map((k) => [k, b[k] - a[k]])) : null);

function gitInfo() {
  try {
    const sha = execSync('git rev-parse HEAD', { cwd: root }).toString().trim();
    const dirty = execSync('git status --porcelain', { cwd: root }).toString().trim().length > 0;
    return { sha, dirty };
  } catch {
    return { sha: null, dirty: null };
  }
}

// ---- one cell = (experiment, strategy, concurrency) ----------------------------------------
async function runCell({ log, platform, admin, exp, expCfg, strategy, c, trials, cellSeed }) {
  const conns = [];
  for (let i = 0; i < c; i++) conns.push(await platform.connect());
  const k = expCfg.seatsPerRequest ?? 1;
  const ops = expCfg.opsPerClient ?? 1;
  const pool = expCfg.seatPool ?? c * ops;
  const statsBefore = await pgStats(admin, platform.name);
  log.event({ type: 'cell_start', exp, strategy, c, trials, k, pool, ops });

  for (let t = 0; t < trials + config.warmupTrialsPerCell; t++) {
    const warmup = t < config.warmupTrialsPerCell;
    const trialId = `${RUN_ID}:${exp}:${strategy}:c${c}:t${t}`;
    const rnd = mulberry32(cellSeed * 1000 + t);
    await setupTrial(admin, trialId, pool);

    // Inputs are generated before the barrier so all clients start together.
    const plans = conns.map((_, i) => {
      if (exp === 'E3') return Array.from({ length: ops }, (_, j) => [i * ops + j + 1]);
      if (k === 1 && pool === 1) return [[1]];
      return [shuffle(Array.from({ length: pool }, (_, s) => s + 1), rnd).slice(0, k)];
    });

    let open;
    const gate = new Promise((r) => (open = r));
    const cpu0 = process.cpuUsage();
    const tasks = conns.map((db, i) =>
      (async () => {
        await gate;
        const out = [];
        for (const seats of plans[i]) {
          const t0 = performance.now();
          const r = await attempt(strategy, db, { trial: trialId, seats, clientId: i + 1 });
          out.push({ ...r, seats, tStartMs: t0, latencyMs: performance.now() - t0 });
        }
        return out;
      })(),
    );
    const wall0 = performance.now();
    const startedAt = new Date().toISOString();
    open();
    const results = (await Promise.all(tasks)).flatMap((r, i) => r.map((x) => ({ ...x, client: i + 1 })));
    const makespanMs = performance.now() - wall0;
    const cpu = process.cpuUsage(cpu0);

    for (const r of results) {
      log.op({
        exp, strategy, c, trial: t, warmup, client: r.client, seats: r.seats, outcome: r.outcome,
        sqlstate: r.sqlstate ?? null, error: r.error ?? null,
        latencyMs: +r.latencyMs.toFixed(3), offsetMs: +(r.tStartMs - wall0).toFixed(3),
      });
    }
    const v = await verifyTrial(admin, trialId);
    const count = (o) => results.filter((r) => r.outcome === o).length;
    log.trial({
      exp, strategy, c, trial: t, warmup, startedAt, makespanMs: +makespanMs.toFixed(3),
      attempts: results.length, successes: count('success'), conflicts: count('conflict'),
      deadlocks: count('deadlock'), serializationFailures: count('serialization_failure'), errors: count('error'),
      ...v, clientCpuMs: +((cpu.user + cpu.system) / 1000).toFixed(1), rssMb: +(process.memoryUsage().rss / 2 ** 20).toFixed(1),
    });
  }

  const statsAfter = await pgStats(admin, platform.name);
  log.event({ type: 'cell_end', exp, strategy, c, serverStats: diff(statsBefore, statsAfter) });
  for (const cn of conns) cn.release();
}

// ---- main ----------------------------------------------------------------------------------
async function main() {
  const usePglite = EXPS.includes('E5');
  const maxC = Math.max(...EXPS.flatMap((e) => config.experiments[e].concurrency));
  const platform = usePglite ? await pglitePlatform() : await neonPlatform(maxC);
  const admin = await platform.connect();
  for (const stmt of SCHEMA_SQL.split(';').map((s) => s.trim()).filter(Boolean)) await admin.query(stmt);
  await admin.query('TRUNCATE research.show_seats, research.claims');

  // Network baseline: round-trip time of a trivial query.
  const rtt = [];
  for (let i = 0; i < 20; i++) {
    const t0 = performance.now();
    await admin.query('SELECT 1');
    rtt.push(performance.now() - t0);
  }
  const server = (await admin.query('SELECT version() AS v, current_setting(\'default_transaction_isolation\') AS iso')).rows[0];

  const log = createLogger(RUN_ID);
  const cells = [];
  for (const exp of EXPS) {
    const e = config.experiments[exp];
    for (const strategy of e.strategies) for (const c of e.concurrency) cells.push({ exp, strategy, c, trials: QUICK ? 3 : e.trials });
  }
  // Randomised execution order (setup randomisation against time-of-day drift).
  const order = shuffle(cells, mulberry32(config.seed));
  const manifest = {
    runId: RUN_ID,
    startedAt: new Date().toISOString(),
    experiments: EXPS,
    quick: QUICK,
    git: gitInfo(),
    node: process.version,
    os: `${os.type()} ${os.release()} ${os.arch()}`,
    cpu: os.cpus()[0]?.model?.trim(),
    cpuCount: os.cpus().length,
    memoryGb: +(os.totalmem() / 2 ** 30).toFixed(1),
    platform: platform.describe,
    server: { version: server.v, defaultIsolation: server.iso },
    networkRttMs: { samples: rtt.map((x) => +x.toFixed(2)) },
    config,
    executionOrder: order.map((o) => `${o.exp}/${o.strategy}/c${o.c}`),
  };
  log.manifest(manifest);
  log.event({ type: 'run_start', runId: RUN_ID, totalCells: order.length, manifest });

  let i = 0;
  for (const cell of order) {
    i++;
    process.stdout.write(`[${i}/${order.length}] ${cell.exp} ${cell.strategy} c=${cell.c} … `);
    const t0 = performance.now();
    await runCell({
      log, platform, admin, ...cell, expCfg: config.experiments[cell.exp],
      cellSeed: config.seed + i,
    });
    console.log(`${((performance.now() - t0) / 1000).toFixed(1)}s`);
    log.event({ type: 'progress', done: i, total: order.length });
  }
  log.event({ type: 'run_end', finishedAt: new Date().toISOString() });
  manifest.finishedAt = new Date().toISOString();
  log.manifest(manifest);
  await log.close();
  admin.release();
  await platform.close();
  console.log(`\nRaw log: data/raw/${RUN_ID}/events.jsonl · manifest: experiments/logs/${RUN_ID}/manifest.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
