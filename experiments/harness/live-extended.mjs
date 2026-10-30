// E8 (scalability) and E9 (reliability under failure injection) against the DEPLOYED CineBook.
//   node experiments/harness/live-extended.mjs [--run name] [--only E8|E9] [--skip-cleanup]
// Requests go out with Node's fetch (enough sockets for 500 simultaneous users); the
// database is read directly only to verify invariants and to inject hold expiry.
// Every research account is research+<run>-<n>@cinebook.test and is deleted afterwards.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { createLogger } from './log.mjs';
import { CONFIG, ROOT } from './paths.mjs';
import { mulberry32, shuffle } from './stats.mjs';

const require = createRequire(import.meta.url);
const pg = require('pg');
const { chromium } = require('@playwright/test');
const config = JSON.parse(readFileSync(CONFIG, 'utf8'));
const L = config.live;
const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const RUN_ID = opt('run', `live-ext-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`);
const ONLY = opt('only', null);
const tag = RUN_ID.replace(/[^a-z0-9-]/gi, '').toLowerCase();
const rnd = mulberry32(config.seed + 11);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const B = `${L.baseUrl}/api/v1`;

const databaseUrl = () =>
  readFileSync(resolve(ROOT, 'apps/api/.env'), 'utf8').split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL=')).slice(13).trim();

const log = createLogger(RUN_ID);

// Our own deployment sits behind Vercel's bot checkpoint, which challenges Node's TLS client;
// calls therefore go through a real Chromium context's request client (as in live.mjs).
let api;
let browser;
async function openClient() {
  browser = await chromium.launch({ args: ['--disable-blink-features=AutomationControlled'] });
  const ctx = await browser.newContext({ userAgent: UA });
  const page = await ctx.newPage();
  await page.goto(L.baseUrl, { timeout: 60_000 });
  await page.waitForTimeout(4000);
  api = ctx.request;
}

async function call(method, path, { token, body, headers = {}, timeoutMs = 60_000 } = {}) {
  const t0 = performance.now();
  try {
    const r = await api.fetch(B + path, {
      method,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
      data: body,
      failOnStatusCode: false,
      timeout: timeoutMs,
    });
    let json = null;
    try { json = await r.json(); } catch { /* not json */ }
    return { status: r.status(), json, latencyMs: performance.now() - t0, challenged: r.headers()['x-vercel-mitigated'] === 'challenge' };
  } catch (e) {
    return { status: 0, json: null, latencyMs: performance.now() - t0, aborted: /timeout/i.test(String(e.message)), error: String(e.message).slice(0, 80) };
  }
}

/** Run fn over items with at most `limit` in flight. */
async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

async function main() {
  await openClient();
  const db = new pg.Client({ connectionString: databaseUrl() });
  await db.connect();
  const manifest = {
    runId: RUN_ID, startedAt: new Date().toISOString(), baseUrl: L.baseUrl, design: { E8: L.E8, E9: L.E9 }, only: ONLY,
    client: 'Node.js fetch (undici), single client machine in India → Vercel (sin1) → Neon ap-southeast-1',
  };
  log.manifest(manifest);
  log.event({ type: 'run_start', runId: RUN_ID, totalCells: 0, manifest });

  // ---- discovery: shows ≥ 3 h away so cancellation is permitted -------------------------
  const city = (await call('GET', '/cities')).json.cities[0];
  const shows = [];
  for (const m of (await call('GET', `/movies?status=now_showing&city=${city.id}`)).json.movies) {
    const s = (await call('GET', `/movies/${m.id}/showtimes?city=${city.id}`)).json;
    for (const d of (s?.dates ?? []).filter((x) => x.hasShows).slice(1, 4)) {
      const sd = (await call('GET', `/movies/${m.id}/showtimes?city=${city.id}&date=${d.date}`)).json;
      for (const t of sd.theatres) for (const sh of t.showtimes) if (new Date(sh.startsAt) - Date.now() > 3 * 3600_000) shows.push(sh.id);
    }
    if (shows.length >= 40) break;
  }
  console.log(`discovered ${shows.length} future showtimes`);
  const freeSeats = async (showId) => (await call('GET', `/showtimes/${showId}/seats`)).json.seats.filter((s) => s.state === 'AVAILABLE');

  // ---- research users -------------------------------------------------------------------
  const nUsers = ONLY === 'E9' ? 4 : Math.max(...L.E8.users);
  const users = (await pool(Array.from({ length: nUsers }, (_, i) => i), 20, async (i) => {
    const r = await call('POST', '/auth/signup', {
      body: { name: `Research User ${i + 1}`, email: `research+${tag}-${i}@cinebook.test`, phone: '9876543210', password: 'research123' },
    });
    return r.status === 201 ? { id: r.json.user.id, token: r.json.accessToken } : null;
  })).filter(Boolean);
  console.log(`signed up ${users.length}/${nUsers} research users`);
  // Access tokens live 15 min; refresh by logging in again when a phase starts.
  const relogin = async (list) => {
    await pool(list, 20, async (u, i) => {
      const r = await call('POST', '/auth/login', { body: { email: `research+${tag}-${users.indexOf(u)}@cinebook.test`, password: 'research123' } });
      if (r.status === 200) u.token = r.json.accessToken;
    });
  };

  // =======================================================================================
  // E9: reliability under failure injection
  // =======================================================================================
  if (!ONLY || ONLY === 'E9') {
    const [A, Bu] = users;
    const T = L.E9.trialsPerScenario;
    const seatState = async (showId, seatId) => (await db.query('SELECT status FROM show_seats WHERE showtime_id=$1 AND seat_id=$2', [showId, seatId])).rows[0]?.status;
    const payRows = async (bookingId) => (await db.query(
      `SELECT count(*)::int n, count(*) FILTER (WHERE status='SUCCESS')::int ok, count(*) FILTER (WHERE status='REFUNDED')::int refunded,
              count(*) FILTER (WHERE status='FAILED')::int failed FROM payments WHERE booking_id=$1`, [bookingId])).rows[0];
    const bookingStatus = async (id) => (await db.query('SELECT status FROM bookings WHERE id=$1', [id])).rows[0]?.status;
    const card = (last4) => ({ method: 'card', cardNumber: last4 === '1111' ? '4111 1111 1111 1111' : `4242 4242 4242 ${last4}`, name: 'Research User', expiry: '12/39' });
    const holdOne = async (u, showId) => {
      for (let k = 0; k < 5; k++) {
        const free = await freeSeats(showId);
        const seat = free[Math.floor(rnd() * free.length)];
        const h = await call('POST', `/showtimes/${showId}/holds`, { token: u.token, body: { seatIds: [seat.id] } });
        if (h.status === 201) return { seat, bookingId: h.json.bookingId };
      }
      throw new Error('could not hold a seat');
    };
    const scenarios = {
      async declined_card(t) {
        const showId = shows[t % shows.length];
        const { seat, bookingId } = await holdOne(A, showId);
        const r = await call('POST', `/bookings/${bookingId}/pay`, { token: A.token, body: card('0000'), headers: { 'Idempotency-Key': `r-${tag}-dec-${t}` } });
        const p = await payRows(bookingId);
        return {
          httpStatus: r.status, latencyMs: r.latencyMs, paymentStatus: r.json?.status, bookingStatus: await bookingStatus(bookingId),
          seatAfter: await seatState(showId, seat.id), charges: p.ok,
          pass: r.json?.status === 'FAILED' && p.ok === 0 && (await seatState(showId, seat.id)) === 'AVAILABLE',
        };
      },
      async bank_timeout_client_abort_retry(t) {
        const showId = shows[(t + 5) % shows.length];
        const { seat, bookingId } = await holdOne(A, showId);
        const key = `r-${tag}-tmo-${t}`;
        const first = await call('POST', `/bookings/${bookingId}/pay`, { token: A.token, body: card('1111'), headers: { 'Idempotency-Key': key }, timeoutMs: L.E9.clientAbortSec * 1000 });
        const t0 = performance.now();
        let retry; let attempts = 0;
        do { attempts++; retry = await call('POST', `/bookings/${bookingId}/pay`, { token: A.token, body: card('1111'), headers: { 'Idempotency-Key': key } }); if (retry.status === 409) await sleep(500); } while (retry.status === 409 && attempts < 20);
        const p = await payRows(bookingId);
        const res = {
          httpStatus: first.status, clientAborted: !!first.aborted, retryStatus: retry.status, replayed: retry.json?.replayed ?? null, retries: attempts,
          recoveryMs: performance.now() - t0, latencyMs: first.latencyMs, bookingStatus: await bookingStatus(bookingId), seatAfter: await seatState(showId, seat.id), charges: p.ok,
        };
        res.pass = res.clientAborted && retry.json?.status === 'SUCCESS' && p.ok === 1 && res.bookingStatus === 'CONFIRMED';
        await call('POST', `/bookings/${bookingId}/cancel`, { token: A.token });
        return res;
      },
      async network_abort_retry(t) {
        const showId = shows[(t + 10) % shows.length];
        const { seat, bookingId } = await holdOne(A, showId);
        const key = `r-${tag}-net-${t}`;
        const first = await call('POST', `/bookings/${bookingId}/pay`, { token: A.token, body: card('4242'), headers: { 'Idempotency-Key': key }, timeoutMs: L.E9.networkAbortMs });
        const t0 = performance.now();
        let retry; let attempts = 0;
        do { attempts++; retry = await call('POST', `/bookings/${bookingId}/pay`, { token: A.token, body: card('4242'), headers: { 'Idempotency-Key': key } }); if (retry.status === 409) await sleep(500); } while (retry.status === 409 && attempts < 20);
        const p = await payRows(bookingId);
        const res = {
          httpStatus: first.status, clientAborted: !!first.aborted, retryStatus: retry.status, replayed: retry.json?.replayed ?? null, retries: attempts,
          recoveryMs: performance.now() - t0, latencyMs: first.latencyMs, bookingStatus: await bookingStatus(bookingId), seatAfter: await seatState(showId, seat.id), charges: p.ok,
        };
        // If the aborted request never reached the server, the retry is simply the first charge.
        res.pass = retry.json?.status === 'SUCCESS' && p.ok === 1 && p.n === 1 && res.bookingStatus === 'CONFIRMED';
        await call('POST', `/bookings/${bookingId}/cancel`, { token: A.token });
        return res;
      },
      async hold_expires_mid_payment(t) {
        const showId = shows[(t + 15) % shows.length];
        const { seat, bookingId } = await holdOne(A, showId);
        // The gateway "talks to the bank" for 1.5 s; the hold lapses 1 s from now, in between.
        await db.query(`UPDATE bookings SET hold_expires_at = now() + interval '1 second' WHERE id=$1`, [bookingId]);
        await db.query(`UPDATE show_seats SET hold_expires_at = now() + interval '1 second' WHERE hold_id=$1`, [bookingId]);
        const r = await call('POST', `/bookings/${bookingId}/pay`, { token: A.token, body: card('4242'), headers: { 'Idempotency-Key': `r-${tag}-exp-${t}` } });
        const p = await payRows(bookingId);
        const res = {
          httpStatus: r.status, code: r.json?.error?.code, latencyMs: r.latencyMs, bookingStatus: await bookingStatus(bookingId),
          seatAfter: await seatState(showId, seat.id), charges: p.ok, refunds: p.refunded,
        };
        res.pass = r.status === 410 && p.ok === 0 && res.seatAfter === 'AVAILABLE' && res.bookingStatus !== 'CONFIRMED';
        return res;
      },
      async expired_hold_reclaimed(t) {
        const showId = shows[(t + 20) % shows.length];
        const { seat, bookingId } = await holdOne(A, showId);
        await db.query(`UPDATE show_seats SET hold_expires_at = now() - interval '1 second' WHERE hold_id=$1`, [bookingId]);
        await db.query(`UPDATE bookings SET hold_expires_at = now() - interval '1 second' WHERE id=$1`, [bookingId]);
        const b = await call('POST', `/showtimes/${showId}/holds`, { token: Bu.token, body: { seatIds: [seat.id] } });
        const lateA = await call('POST', `/bookings/${bookingId}/pay`, { token: A.token, body: card('4242'), headers: { 'Idempotency-Key': `r-${tag}-rec-${t}` } });
        const owner = (await db.query('SELECT held_by FROM show_seats WHERE showtime_id=$1 AND seat_id=$2', [showId, seat.id])).rows[0]?.held_by;
        const p = await payRows(bookingId);
        const res = {
          httpStatus: b.status, latencyMs: b.latencyMs, lateOwnerPayStatus: lateA.status, code: lateA.json?.error?.code,
          seatAfter: await seatState(showId, seat.id), charges: p.ok, ownerIsB: owner === Bu.id,
        };
        res.pass = b.status === 201 && lateA.status === 410 && owner === Bu.id && p.ok === 0;
        if (b.status === 201) await call('DELETE', `/holds/${b.json.bookingId}`, { token: Bu.token });
        return res;
      },
      async partial_multi_seat_rollback(t) {
        const showId = shows[(t + 25) % shows.length];
        const { seat: x, bookingId } = await holdOne(A, showId);
        const others = (await freeSeats(showId)).slice(0, 2);
        const r = await call('POST', `/showtimes/${showId}/holds`, { token: Bu.token, body: { seatIds: [others[0].id, x.id, others[1].id] } });
        const states = [await seatState(showId, others[0].id), await seatState(showId, others[1].id)];
        const res = {
          httpStatus: r.status, code: r.json?.error?.code, latencyMs: r.latencyMs, seatAfter: states.join('/'),
          conflictingSeatReported: (r.json?.error?.details?.seatIds ?? []).includes(x.id),
        };
        res.pass = r.status === 409 && states.every((s) => s === 'AVAILABLE');
        await call('DELETE', `/holds/${bookingId}`, { token: A.token });
        return res;
      },
    };
    const cells = shuffle(Object.keys(scenarios).flatMap((s) => Array.from({ length: T }, (_, t) => [s, t])), rnd);
    log.event({ type: 'cell_start', exp: 'E9', strategy: 'failure-injection', c: 1 });
    let done = 0;
    let lastLogin = performance.now();
    for (const [name, t] of cells) {
      if (performance.now() - lastLogin > 10 * 60_000) { await relogin([A, Bu]); lastLogin = performance.now(); }
      let r;
      try { r = await scenarios[name](t); } catch (e) { r = { pass: false, error: String(e.message).slice(0, 160) }; }
      log.trial({ exp: 'E9', strategy: name, c: 1, trial: t, ...r, latencyMs: r.latencyMs != null ? +r.latencyMs.toFixed(1) : null, recoveryMs: r.recoveryMs != null ? +r.recoveryMs.toFixed(1) : null });
      console.log(`E9 ${name} #${t}: ${r.pass ? 'PASS' : 'FAIL'} ${JSON.stringify(r).slice(0, 180)}`);
      log.event({ type: 'progress', done: ++done, total: cells.length });
    }
  }

  // =======================================================================================
  // E8: scalability — N users at once, read and write workloads, randomised cell order
  // =======================================================================================
  if (!ONLY || ONLY === 'E8') {
    const cells = shuffle(L.E8.users.flatMap((n) => ['read', 'write'].flatMap((w) => Array.from({ length: L.E8.repeats }, (_, r) => ({ n, w, r })))), rnd);
    // A pool of distinct (showtime, seat) pairs for write cells, so writers never collide.
    const pairs = [];
    for (const s of shows) { for (const seat of await freeSeats(s)) pairs.push([s, seat.id]); if (pairs.length > 2000) break; }
    console.log(`E8: ${cells.length} cells, ${pairs.length} distinct seats available for writers`);
    let lastLogin = performance.now();
    let done = 0;
    for (const { n, w, r } of cells) {
      if (performance.now() - lastLogin > 10 * 60_000) { await relogin(users); lastLogin = performance.now(); }
      const crowd = users.slice(0, n);
      log.event({ type: 'cell_start', exp: 'E8', strategy: w, c: n });
      const ops = [];
      const wall0 = performance.now();
      if (w === 'read') {
        await Promise.all(crowd.map(async (u, i) => {
          for (let k = 0; k < L.E8.readRequestsPerUser; k++) {
            const res = await call('GET', `/showtimes/${shows[(i + k) % shows.length]}/seats`, { token: u.token });
            ops.push({ op: 'seatmap', status: res.status, latencyMs: res.latencyMs });
          }
        }));
      } else {
        const mine = shuffle(pairs.slice(), rnd).slice(0, n);
        await Promise.all(crowd.map(async (u, i) => {
          const [showId, seatId] = mine[i];
          const h = await call('POST', `/showtimes/${showId}/holds`, { token: u.token, body: { seatIds: [seatId] } });
          ops.push({ op: 'hold', status: h.status, latencyMs: h.latencyMs });
          if (h.status === 201) {
            const d = await call('DELETE', `/holds/${h.json.bookingId}`, { token: u.token });
            ops.push({ op: 'release', status: d.status, latencyMs: d.latencyMs });
          }
        }));
      }
      const makespanMs = performance.now() - wall0;
      for (const o of ops) {
        log.op({ exp: 'E8', strategy: w, c: n, trial: r, op: o.op, status: o.status, latencyMs: +o.latencyMs.toFixed(1),
          outcome: o.status >= 200 && o.status < 300 ? 'success' : o.status === 409 ? 'conflict' : 'error' });
      }
      const ok = ops.filter((o) => o.status >= 200 && o.status < 300).length;
      log.trial({ exp: 'E8', strategy: w, c: n, trial: r, ops: ops.length, ok, errors: ops.length - ok, makespanMs: +makespanMs.toFixed(1), throughput: +(ok / (makespanMs / 1000)).toFixed(2) });
      console.log(`E8 ${w} n=${n} rep ${r}: ${ok}/${ops.length} ok, ${(ok / (makespanMs / 1000)).toFixed(1)} ops/s, makespan ${makespanMs.toFixed(0)} ms`);
      log.event({ type: 'progress', done: ++done, total: cells.length });
      await sleep(L.E8.pauseBetweenCellsSec * 1000);
    }
  }

  // ---- global invariants on the live database --------------------------------------------
  const inv = (await db.query(`
    SELECT
      (SELECT count(*) FROM show_seats ss LEFT JOIN bookings b ON b.id = ss.booking_id
        WHERE ss.status='BOOKED' AND (b.id IS NULL OR b.status <> 'CONFIRMED'))::int AS booked_without_confirmed,
      (SELECT count(*) FROM (SELECT booking_id FROM payments WHERE status='SUCCESS' GROUP BY booking_id HAVING count(*) > 1) x)::int AS double_charged_bookings,
      (SELECT count(*) FROM bookings b WHERE b.status='CONFIRMED'
        AND b.seat_count <> (SELECT count(*) FROM show_seats ss WHERE ss.booking_id=b.id AND ss.status='BOOKED'))::int AS confirmed_seat_mismatch,
      (SELECT count(*) FROM show_seats WHERE status='HELD' AND hold_id IS NULL)::int AS held_without_hold`)).rows[0];
  log.trial({ exp: 'E9-invariants', strategy: 'database', trial: 0, ...inv });
  console.log('invariants', inv);

  // ---- cleanup --------------------------------------------------------------------------
  if (!args.includes('--skip-cleanup')) {
    const pattern = `research+${tag}-%@cinebook.test`;
    await db.query('BEGIN');
    const ids = (await db.query('SELECT id FROM users WHERE email LIKE $1', [pattern])).rows.map((r) => r.id);
    const b = (await db.query('SELECT id FROM bookings WHERE user_id = ANY($1::uuid[])', [ids])).rows.map((r) => r.id);
    await db.query(
      `UPDATE show_seats SET status='AVAILABLE', held_by=NULL, hold_id=NULL, hold_expires_at=NULL, booking_id=NULL
        WHERE held_by = ANY($1::uuid[]) OR booking_id = ANY($2::uuid[]) OR hold_id = ANY($2::uuid[])`, [ids, b]);
    await db.query('DELETE FROM payments WHERE booking_id = ANY($1::uuid[])', [b]);
    await db.query('DELETE FROM bookings WHERE id = ANY($1::uuid[])', [b]);
    await db.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [ids]);
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
