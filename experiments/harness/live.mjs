// E4: experiments against the DEPLOYED CineBook (Vercel + Neon), end to end over HTTPS.
//   node experiments/harness/live.mjs [--run name] [--skip-cleanup]
// Uses a real Chromium context so requests pass Vercel's bot checkpoint; API calls go
// through the context's request client (shares the checkpoint cookie).
// Every research account is research+<run>-<n>@cinebook.test and is deleted afterwards.
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { createLogger } from './log.mjs';
import { CONFIG, ROOT } from './paths.mjs';
import { mulberry32 } from './stats.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('@playwright/test');
const pg = require('pg');
const root = ROOT;
const config = JSON.parse(readFileSync(CONFIG, 'utf8'));
const L = config.live;
const args = process.argv.slice(2);
const RUN_ID = args.includes('--run') ? args[args.indexOf('--run') + 1] : `live-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`;
const tag = RUN_ID.replace(/[^a-z0-9-]/gi, '').toLowerCase();
const rnd = mulberry32(config.seed + 7);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function databaseUrl() {
  const line = readFileSync(resolve(root, 'apps/api/.env'), 'utf8').split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL='));
  return line.slice('DATABASE_URL='.length).trim();
}

const log = createLogger(RUN_ID);

async function main() {
  const browser = await chromium.launch({ args: ['--disable-blink-features=AutomationControlled'] });
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  });
  const page = await ctx.newPage();
  await page.goto(L.baseUrl);
  await page.waitForLoadState('networkidle');
  const api = ctx.request;
  const B = `${L.baseUrl}/api/v1`;

  const call = async (method, path, { token, body, headers = {} } = {}) => {
    const t0 = performance.now();
    const r = await api.fetch(B + path, {
      method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
      data: body,
      failOnStatusCode: false,
      timeout: 60_000,
    });
    const latencyMs = performance.now() - t0;
    let json = null;
    try { json = await r.json(); } catch { /* not json */ }
    return { status: r.status(), json, latencyMs, headers: r.headers() };
  };

  const manifest = {
    runId: RUN_ID, startedAt: new Date().toISOString(), baseUrl: L.baseUrl, design: L,
    clientLocation: 'India (client machine) → Vercel edge → function in sin1 (Singapore) → Neon ap-southeast-1',
  };
  log.manifest(manifest);
  log.event({ type: 'run_start', runId: RUN_ID, totalCells: 3, manifest });

  // ---- discover live ids -----------------------------------------------------------------
  const city = (await call('GET', '/cities')).json.cities[0];
  // The first requests may trigger the deployment's rolling 7-day schedule top-up;
  // retry until a movie with upcoming shows in this city appears.
  let movie;
  let st;
  for (let attempt = 0; attempt < 12 && !movie; attempt++) {
    if (attempt) await sleep(5000);
    const all = (await call('GET', `/movies?status=now_showing&city=${city.id}`)).json?.movies ?? [];
    for (const m of all) {
      const s = (await call('GET', `/movies/${m.id}/showtimes?city=${city.id}`)).json;
      if (s?.theatres?.length && s.dates.filter((d) => d.hasShows).length >= 3) {
        movie = m;
        st = s;
        break;
      }
    }
  }
  if (!movie) throw new Error('No movie with upcoming shows found on the live site');
  const firstShow = st.theatres[0].showtimes[0];

  // ---- E4a: read latency ----------------------------------------------------------------
  log.event({ type: 'cell_start', exp: 'E4a', strategy: 'live-read', c: 1 });
  const endpoints = {
    health: '/health',
    movies: `/movies?status=now_showing&city=${city.id}`,
    showtimes: `/movies/${movie.id}/showtimes?city=${city.id}`,
    seats: `/showtimes/${firstShow.id}/seats`,
  };
  for (let round = 0; round < L.E4a.rounds; round++) {
    if (round > 0) await sleep(L.E4a.pauseBetweenRoundsSec * 1000);
    // Static asset from Vercel's CDN = network baseline for this round.
    for (let i = 0; i < 10; i++) {
      const t0 = performance.now();
      const r = await api.get(`${L.baseUrl}/favicon.svg`, { failOnStatusCode: false });
      log.op({ exp: 'E4a', strategy: 'cdn-baseline', c: 1, trial: round, endpoint: 'static', status: r.status(), latencyMs: +(performance.now() - t0).toFixed(2), first: i === 0 });
    }
    for (let i = 0; i < L.E4a.samplesPerEndpointPerRound; i++) {
      // Interleave endpoints so drift affects all of them equally.
      for (const [name, path] of Object.entries(endpoints)) {
        const r = await call('GET', path);
        log.op({
          exp: 'E4a', strategy: name, c: 1, trial: round, sample: i, endpoint: name, status: r.status,
          latencyMs: +r.latencyMs.toFixed(2), first: i === 0, cache: r.headers['x-vercel-cache'] ?? null,
          vercelId: (r.headers['x-vercel-id'] ?? '').split('::').slice(0, -1).join('::'),
          dbLatencyMs: name === 'health' ? r.json?.dbLatencyMs ?? null : null,
          bytes: r.json ? JSON.stringify(r.json).length : null, outcome: r.status === 200 ? 'success' : 'error',
        });
      }
    }
    console.log(`E4a round ${round + 1}/${L.E4a.rounds} done`);
  }
  log.event({ type: 'progress', done: 1, total: 3 });

  // ---- research users -------------------------------------------------------------------
  const users = [];
  for (let i = 0; i < L.E4b.users; i++) {
    const r = await call('POST', '/auth/signup', {
      body: { name: `Research User ${i + 1}`, email: `research+${tag}-${i}@cinebook.test`, phone: '9876543210', password: 'research123' },
    });
    if (r.status !== 201) throw new Error(`signup failed: ${r.status} ${JSON.stringify(r.json)}`);
    users.push({ id: r.json.user.id, token: r.json.accessToken });
  }

  // Shows at least 3 h away so later cancellation (≥ 2 h rule) is allowed.
  const futureShows = [];
  for (const d of st.dates.filter((x) => x.hasShows).slice(1)) {
    const s = (await call('GET', `/movies/${movie.id}/showtimes?city=${city.id}&date=${d.date}`)).json;
    for (const t of s.theatres) for (const sh of t.showtimes) if (new Date(sh.startsAt).getTime() - Date.now() > 3 * 3600_000) futureShows.push(sh.id);
  }
  const pickSeat = async (showId) => {
    const m = (await call('GET', `/showtimes/${showId}/seats`)).json;
    const free = m.seats.filter((s) => s.state === 'AVAILABLE');
    return free[Math.floor(rnd() * free.length)];
  };

  // ---- E4b: hot-seat race ---------------------------------------------------------------
  log.event({ type: 'cell_start', exp: 'E4b', strategy: 'live-hot-seat', c: users.length });
  for (let t = 0; t < L.E4b.trials; t++) {
    const showId = futureShows[t % futureShows.length];
    const seat = await pickSeat(showId);
    const wall0 = performance.now();
    const results = await Promise.all(
      users.map(async (u, i) => {
        const r = await call('POST', `/showtimes/${showId}/holds`, { token: u.token, body: { seatIds: [seat.id] } });
        return { client: i + 1, ...r };
      }),
    );
    const makespanMs = performance.now() - wall0;
    for (const r of results) {
      log.op({
        exp: 'E4b', strategy: 'conditional_update(live)', c: users.length, trial: t, client: r.client, status: r.status,
        outcome: r.status === 201 ? 'success' : r.status === 409 ? 'conflict' : 'error',
        code: r.json?.error?.code ?? null, latencyMs: +r.latencyMs.toFixed(2),
      });
    }
    const winners = results.filter((r) => r.status === 201);
    const after = (await call('GET', `/showtimes/${showId}/seats`)).json.seats.find((s) => s.id === seat.id).state;
    // Release so the live system is left as found.
    for (const w of winners) {
      const owner = users[w.client - 1];
      await call('DELETE', `/holds/${w.json.bookingId}`, { token: owner.token });
    }
    const released = (await call('GET', `/showtimes/${showId}/seats`)).json.seats.find((s) => s.id === seat.id).state;
    log.trial({
      exp: 'E4b', strategy: 'conditional_update(live)', c: users.length, trial: t, makespanMs: +makespanMs.toFixed(2),
      attempts: results.length, successes: winners.length, conflicts: results.filter((r) => r.status === 409).length,
      errors: results.filter((r) => r.status !== 201 && r.status !== 409).length,
      doubleBookings: Math.max(0, winners.length - 1), seatStateAfterRace: after, seatStateAfterRelease: released,
    });
    console.log(`E4b trial ${t + 1}: winners=${winners.length} seat=${after} → ${released}`);
  }
  log.event({ type: 'progress', done: 2, total: 3 });

  // ---- E4c: payment idempotency ----------------------------------------------------------
  log.event({ type: 'cell_start', exp: 'E4c', strategy: 'live-idempotency', c: L.E4c.parallelSubmits });
  const db = new pg.Client({ connectionString: databaseUrl() });
  await db.connect();
  for (let t = 0; t < L.E4c.trials; t++) {
    const u = users[t % users.length];
    const showId = futureShows[(t + 3) % futureShows.length];
    const seat = await pickSeat(showId);
    const hold = await call('POST', `/showtimes/${showId}/holds`, { token: u.token, body: { seatIds: [seat.id] } });
    if (hold.status !== 201) { console.log('hold failed, skipping trial', hold.status); continue; }
    const bookingId = hold.json.bookingId;
    const key = `research-${tag}-${t}-${Math.floor(rnd() * 1e9)}`;
    const body = { method: 'card', cardNumber: '4242 4242 4242 4242', name: 'Research User', expiry: '12/39' };
    const wall0 = performance.now();
    const res = await Promise.all(
      Array.from({ length: L.E4c.parallelSubmits }, () => call('POST', `/bookings/${bookingId}/pay`, { token: u.token, body, headers: { 'Idempotency-Key': key } })),
    );
    const makespanMs = performance.now() - wall0;
    // One retry with the same key after the dust settles must replay, not charge again.
    const replay = await call('POST', `/bookings/${bookingId}/pay`, { token: u.token, body, headers: { 'Idempotency-Key': key } });
    const payments = (await db.query('SELECT count(*)::int AS n, count(*) FILTER (WHERE status = $2)::int AS ok FROM payments WHERE booking_id = $1', [bookingId, 'SUCCESS'])).rows[0];
    for (const r of [...res, replay]) {
      log.op({ exp: 'E4c', strategy: 'idempotency-key(live)', c: L.E4c.parallelSubmits, trial: t, status: r.status, code: r.json?.error?.code ?? r.json?.status ?? null, replayed: r.json?.replayed ?? null, latencyMs: +r.latencyMs.toFixed(2), outcome: r.status === 200 ? 'success' : r.status === 409 ? 'conflict' : 'error' });
    }
    const cancel = await call('POST', `/bookings/${bookingId}/cancel`, { token: u.token });
    log.trial({
      exp: 'E4c', strategy: 'idempotency-key(live)', c: L.E4c.parallelSubmits, trial: t, makespanMs: +makespanMs.toFixed(2),
      attempts: res.length, successes: res.filter((r) => r.status === 200).length, conflicts: res.filter((r) => r.status === 409).length,
      paymentRows: payments.n, successfulPayments: payments.ok, doubleCharges: Math.max(0, payments.ok - 1),
      replayStatus: replay.status, replayFlag: replay.json?.replayed ?? null, cancelStatus: cancel.json?.booking?.status ?? cancel.status,
    });
    console.log(`E4c trial ${t + 1}: statuses=${res.map((r) => r.status).join(',')} paymentRows=${payments.n} replay=${replay.json?.replayed} cancel=${cancel.json?.booking?.status}`);
  }
  log.event({ type: 'progress', done: 3, total: 3 });

  // ---- cleanup --------------------------------------------------------------------------
  if (!args.includes('--skip-cleanup')) {
    const pattern = `research+${tag}-%@cinebook.test`;
    await db.query('BEGIN');
    const ids = (await db.query('SELECT id FROM users WHERE email LIKE $1', [pattern])).rows.map((r) => r.id);
    const b = (await db.query('SELECT id FROM bookings WHERE user_id = ANY($1::uuid[])', [ids])).rows.map((r) => r.id);
    await db.query(
      `UPDATE show_seats SET status = 'AVAILABLE', held_by = NULL, hold_id = NULL, hold_expires_at = NULL, booking_id = NULL
        WHERE held_by = ANY($1::uuid[]) OR booking_id = ANY($2::uuid[]) OR hold_id = ANY($2::uuid[])`,
      [ids, b],
    );
    await db.query('DELETE FROM payments WHERE booking_id = ANY($1::uuid[])', [b]);
    await db.query('DELETE FROM bookings WHERE id = ANY($1::uuid[])', [b]); // booking_seats cascade
    await db.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [ids]); // sessions cascade
    await db.query('COMMIT');
    log.event({ type: 'cleanup', users: ids.length, bookings: b.length });
    console.log(`cleanup: removed ${ids.length} research users and ${b.length} bookings`);
  }
  await db.end();
  log.event({ type: 'run_end', finishedAt: new Date().toISOString() });
  manifest.finishedAt = new Date().toISOString();
  log.manifest(manifest);
  await log.close();
  await browser.close();
}

main().catch(async (err) => {
  console.error(err);
  await log.close();
  process.exit(1);
});
