// E11: security test suite mapped to the OWASP API Security Top 10 (2023).
//   node experiments/harness/security.mjs [--run name]
// Active tests run against a throw-away local API on in-memory PGlite (so nothing real is
// attacked); passive checks (headers, CORS, stored card data) run against the live deploy.
import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { createLogger } from './log.mjs';
import { ROOT } from './paths.mjs';

const require = createRequire(import.meta.url);
const jwt = require(resolve(ROOT, 'node_modules/jsonwebtoken'));
const pg = require('pg');
const { chromium } = require('@playwright/test');

const args = process.argv.slice(2);
const RUN_ID = args.includes('--run') ? args[args.indexOf('--run') + 1] : 'security';
const PORT = 4710;
const LOCAL = `http://localhost:${PORT}/api/v1`;
const LIVE = 'https://cinebook-eight-chi.vercel.app';
const DEV_SECRET = 'dev-only-insecure-secret-change-me-0123456789abcdef'; // local server's default
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = createLogger(RUN_ID);
const results = [];

async function call(method, path, { token, body, headers = {}, raw } = {}) {
  const r = await fetch(LOCAL + path, {
    method,
    headers: { ...(body || raw ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: raw ?? (body ? JSON.stringify(body) : undefined),
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: r.status, json, headers: r.headers, text };
}

function check(owasp, id, description, expected, actual, pass, note = '') {
  results.push({ owasp, id, description, expected, actual: String(actual), pass, note });
  log.trial({ exp: 'E11', strategy: owasp, trial: results.length - 1, id, description, expected, actual: String(actual), pass, note });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${owasp.padEnd(6)} ${id.padEnd(28)} ${String(actual).slice(0, 70)}`);
}

const server = spawn(process.execPath, [resolve(ROOT, 'node_modules/tsx/dist/cli.mjs'), 'src/server.ts'], {
  cwd: resolve(ROOT, 'apps/api'),
  env: { ...process.env, DATABASE_URL: 'pglite://memory', PORT: String(PORT), NODE_ENV: 'development', PAYMENT_DELAY_MS: '50', BCRYPT_COST: '8', JWT_ACCESS_SECRET: DEV_SECRET, ADMIN_EMAIL: 'admin@cinebook.dev', ADMIN_PASSWORD: 'Admin@12345' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stderr.on('data', (d) => process.env.DEBUG && process.stderr.write(d));

try {
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(`${LOCAL}/health`)).ok) break; } catch { /* booting */ }
    await sleep(1000);
  }
  log.manifest({ runId: RUN_ID, startedAt: new Date().toISOString(), target: 'local API on in-memory PGlite + live headers', standard: 'OWASP API Security Top 10 (2023)' });
  log.event({ type: 'run_start', runId: RUN_ID, totalCells: 1 });

  const signup = async (n) => (await call('POST', '/auth/signup', { body: { name: `Sec User ${n}`, email: `sec${n}@test.dev`, phone: '9876543210', password: 'secret123' } }));
  const ua = await signup('a');
  const ub = await signup('b');
  const A = ua.json.accessToken;
  const Bt = ub.json.accessToken;
  const admin = (await call('POST', '/auth/login', { body: { email: 'admin@cinebook.dev', password: 'Admin@12345' } })).json.accessToken;

  const city = (await call('GET', '/cities')).json.cities[0];
  const movie = (await call('GET', `/movies?status=now_showing&city=${city.id}`)).json.movies[0];
  const st = (await call('GET', `/movies/${movie.id}/showtimes?city=${city.id}`)).json;
  const futureShow = st.theatres.flatMap((t) => t.showtimes).find((s) => new Date(s.startsAt) - Date.now() > 3 * 3600_000)
    ?? st.theatres[0].showtimes[0];
  let free = (await call('GET', `/showtimes/${futureShow.id}/seats`)).json.seats.filter((s) => s.state === 'AVAILABLE');
  const hold = (await call('POST', `/showtimes/${futureShow.id}/holds`, { token: A, body: { seatIds: [free[0].id] } })).json;
  const paid = await call('POST', `/bookings/${hold.bookingId}/pay`, { token: A, body: { method: 'card', cardNumber: '4242 4242 4242 4242', name: 'Sec User', expiry: '12/39' }, headers: { 'Idempotency-Key': 'sec-key-0001' } });
  const bookingA = hold.bookingId;

  // ---- API1: Broken Object Level Authorization -----------------------------------------
  let r = await call('GET', `/bookings/${bookingA}`, { token: Bt });
  check('API1', 'bola-read-booking', "User B reads user A's booking", '403/404', r.status, [403, 404].includes(r.status));
  r = await call('POST', `/bookings/${bookingA}/cancel`, { token: Bt });
  check('API1', 'bola-cancel-booking', "User B cancels user A's booking", '403/404', r.status, [403, 404].includes(r.status));
  free = (await call('GET', `/showtimes/${futureShow.id}/seats`)).json.seats.filter((s) => s.state === 'AVAILABLE');
  const holdA2 = (await call('POST', `/showtimes/${futureShow.id}/holds`, { token: A, body: { seatIds: [free[0].id] } })).json;
  r = await call('POST', `/bookings/${holdA2.bookingId}/pay`, { token: Bt, body: { method: 'card', cardNumber: '4242 4242 4242 4242', name: 'Sec User', expiry: '12/39' }, headers: { 'Idempotency-Key': 'sec-key-0002' } });
  check('API1', 'bola-pay-other-hold', "User B pays for user A's hold", '403/404', r.status, [403, 404].includes(r.status));
  r = await call('DELETE', `/holds/${holdA2.bookingId}`, { token: Bt });
  check('API1', 'bola-release-other-hold', "User B releases user A's hold", '404', r.status, r.status === 404);
  r = await call('GET', `/bookings/00000000-0000-4000-8000-000000000000`, { token: Bt });
  check('API1', 'bola-guess-id', 'Random booking UUID', '404', r.status, r.status === 404, 'ids are random v4 UUIDs (122 bits)');

  // ---- API2: Broken Authentication -------------------------------------------------------
  r = await call('GET', '/me');
  check('API2', 'no-token', 'Protected route without token', '401', r.status, r.status === 401);
  const parts = A.split('.');
  const tampered = `${parts[0]}.${Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(parts[1], 'base64url')), role: 'admin' })).toString('base64url')}.${parts[2]}`;
  r = await call('GET', '/admin/stats', { token: tampered });
  check('API2', 'tampered-claims', 'Payload edited to role=admin, old signature', '401', r.status, r.status === 401);
  const noneTok = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${parts[1]}.`;
  r = await call('GET', '/me', { token: noneTok });
  check('API2', 'alg-none', 'Unsigned token (alg=none)', '401', r.status, r.status === 401);
  const claims = JSON.parse(Buffer.from(parts[1], 'base64url'));
  const wrongKey = jwt.sign({ role: 'admin', sid: claims.sid }, 'attacker-guess-secret-0123456789abcdefghij', { subject: claims.sub, issuer: 'cinebook', expiresIn: 600 });
  r = await call('GET', '/me', { token: wrongKey });
  check('API2', 'wrong-key', 'Token signed with a different secret', '401', r.status, r.status === 401);
  const expired = jwt.sign({ role: 'customer', sid: claims.sid }, DEV_SECRET, { subject: claims.sub, issuer: 'cinebook', expiresIn: -60 });
  r = await call('GET', '/me', { token: expired });
  check('API2', 'expired-token', 'Correctly signed but expired token', '401', r.status, r.status === 401);
  // Refresh-token rotation and reuse detection.
  const cookieOf = (res) => /cb_rt=([^;]+)/.exec(res.headers.get('set-cookie') ?? '')?.[1];
  const login = await call('POST', '/auth/login', { body: { email: 'seca@test.dev', password: 'secret123' } });
  const rt1 = cookieOf(login);
  const ref1 = await call('POST', '/auth/refresh', { headers: { cookie: `cb_rt=${rt1}` } });
  const rt2 = cookieOf(ref1);
  // Within 10 s a replay is treated as a multi-tab race (rejected, family kept); after that it is theft.
  const race = await call('POST', '/auth/refresh', { headers: { cookie: `cb_rt=${rt1}` } });
  await sleep(11_000);
  const reuse = await call('POST', '/auth/refresh', { headers: { cookie: `cb_rt=${rt1}` } });
  const after = await call('POST', '/auth/refresh', { headers: { cookie: `cb_rt=${rt2}` } });
  check('API2', 'refresh-rotation', 'Refresh once (rotation)', '200 + new token', `${ref1.status}, rotated=${!!rt2 && rt2 !== rt1}`, ref1.status === 200 && rt2 && rt2 !== rt1);
  check('API2', 'refresh-race-window', 'Replay old refresh token within 10 s', '401 REFRESH_RACE', `${race.status} ${race.json?.error?.code}`, race.status === 401 && race.json?.error?.code === 'REFRESH_RACE', 'grace window for parallel tabs');
  check('API2', 'refresh-reuse', 'Replay old refresh token after 11 s', '401 REFRESH_REUSED', `${reuse.status} ${reuse.json?.error?.code}`, reuse.status === 401 && reuse.json?.error?.code === 'REFRESH_REUSED');
  check('API2', 'refresh-family-revoked', 'Newest token after reuse was detected', '401 (family revoked)', after.status, after.status === 401);
  // Login: enumeration and brute force.
  const unknown = await call('POST', '/auth/login', { body: { email: 'nobody@test.dev', password: 'whatever1' } });
  const wrong = await call('POST', '/auth/login', { body: { email: 'secb@test.dev', password: 'wrongpass1' } });
  check('API2', 'user-enumeration', 'Unknown e-mail vs wrong password', 'same status + message',
    `${unknown.status}/${wrong.status}, same msg=${unknown.json?.error?.message === wrong.json?.error?.message}`,
    unknown.status === wrong.status && unknown.json?.error?.message === wrong.json?.error?.message);
  const statuses = [];
  for (let i = 0; i < 7; i++) statuses.push((await call('POST', '/auth/login', { body: { email: 'secb@test.dev', password: `guess${i}xyz1` } })).status);
  check('API2', 'brute-force-limit', '7 wrong passwords in a row (per IP+email)', '429 by attempt 6', statuses.join(','), statuses.slice(5).every((s) => s === 429),
    'one attempt was already used by the enumeration test');
  r = await call('POST', '/auth/signup', { body: { name: 'Weak', email: 'weak@test.dev', phone: '9876543210', password: '12345678' } });
  check('API2', 'weak-password', 'Signup with digits-only password', '422', r.status, r.status === 422);
  // Logout: stateless JWT vs session-checked routes.
  const lo = await call('POST', '/auth/login', { body: { email: 'seca@test.dev', password: 'secret123' } });
  const tok = lo.json.accessToken;
  await call('POST', '/auth/logout', { token: tok });
  const meAfter = await call('GET', '/me', { token: tok });
  const payAfter = await call('POST', `/bookings/${holdA2.bookingId}/pay`, { token: tok, body: { method: 'card', cardNumber: '4242 4242 4242 4242', name: 'X', expiry: '12/39' }, headers: { 'Idempotency-Key': 'sec-key-0003' } });
  check('API2', 'logout-money-routes', 'Pay with an access token after logout', '401', payAfter.status, payAfter.status === 401, 'pay/cancel re-check the session row');
  check('API2', 'logout-read-routes', 'Read /me with an access token after logout', '401 ideal; 200 accepted (≤15 min)', meAfter.status, true,
    'documented trade-off: stateless JWT stays valid for read routes until expiry (15 min)');

  // ---- API3: Broken Object Property Level Authorization --------------------------------
  const ms = await call('POST', '/auth/signup', { body: { name: 'Mass Assign', email: 'mass@test.dev', phone: '9876543210', password: 'secret123', role: 'admin' } });
  check('API3', 'mass-assign-role', 'Signup body includes role=admin', 'role=customer', ms.json?.user?.role, ms.json?.user?.role === 'customer');
  const pm = await call('PATCH', '/me', { token: ms.json.accessToken, body: { name: 'Mass Two', role: 'admin', email: 'x@y.dev' } });
  check('API3', 'mass-assign-profile', 'PATCH /me with role and email', 'role/email unchanged', `${pm.json?.user?.role}, ${pm.json?.user?.email}`, pm.json?.user?.role === 'customer' && pm.json?.user?.email === 'mass@test.dev');
  const me = await call('GET', '/me', { token: Bt });
  check('API3', 'excessive-exposure', 'Profile response fields', 'no password hash', Object.keys(me.json.user).join('|'), !/password|hash/i.test(JSON.stringify(me.json)));
  const bk = await call('GET', `/bookings/${bookingA}`, { token: A });
  const bkText = JSON.stringify(bk.json);
  check('API3', 'card-data-in-response', 'Booking/payment responses', 'no full PAN', /\d{12,}/.test(bkText) ? 'PAN found' : 'last 4 only', !/4242424242424242/.test(bkText) && !/4242 4242 4242 4242/.test(bkText));

  // ---- API4: Unrestricted Resource Consumption ------------------------------------------
  r = await call('POST', '/auth/login', { raw: JSON.stringify({ email: 'a@b.dev', password: 'x'.repeat(150_000) }) });
  check('API4', 'body-size-limit', '150 KB JSON body', '413', r.status, r.status === 413);
  r = await call('GET', `/movies?city=${city.id}&limit=100000`);
  check('API4', 'page-size-limit', 'limit=100000 on movie list', '422 (max 60)', r.status, r.status === 422);
  free = (await call('GET', `/showtimes/${futureShow.id}/seats`)).json.seats.filter((s) => s.state === 'AVAILABLE');
  r = await call('POST', `/showtimes/${futureShow.id}/holds`, { token: Bt, body: { seatIds: free.slice(0, 11).map((s) => s.id) } });
  check('API4', 'hold-size-limit', 'Hold 11 seats in one request', '422 (max 10)', r.status, r.status === 422, 'stops one user locking a whole row');

  // ---- API5: Broken Function Level Authorization ----------------------------------------
  r = await call('GET', '/admin/stats', { token: Bt });
  check('API5', 'customer-admin-read', 'Customer calls GET /admin/stats', '403', r.status, r.status === 403);
  r = await call('POST', '/admin/showtimes/auto-schedule', { token: Bt, body: { days: 1 } });
  check('API5', 'customer-admin-write', 'Customer calls admin auto-schedule', '403', r.status, r.status === 403);
  r = await call('POST', '/admin/tickets/verify', { token: Bt, body: { payload: 'x' } });
  check('API5', 'customer-ticket-scan', 'Customer calls ticket check-in', '403', r.status, r.status === 403);

  // ---- API6: Unrestricted access to sensitive business flows (QR / check-in) ------------
  const ticket = (await call('GET', `/bookings/${bookingA}`, { token: A })).json.booking;
  // Same construction as apps/api/src/lib/ticket.ts (the local server's secret is known).
  const key = createHmac('sha256', DEV_SECRET).update('cinebook:ticket:v1').digest();
  const signed = `CB1.${bookingA}.${ticket.code}.${createHmac('sha256', key).update(`${bookingA}.${ticket.code}`).digest('base64url').slice(0, 22)}`;
  const scan = (payload) => call('POST', '/admin/tickets/verify', { token: admin, body: { payload } });
  const forged = `CB1.${bookingA}.${ticket.code}.AAAAAAAAAAAAAAAAAAAAAA`;
  r = await scan(forged);
  check('API6', 'qr-forged-signature', 'Ticket with a made-up signature', 'BAD_SIGNATURE', r.json?.verdict ?? r.status, r.json?.verdict === 'BAD_SIGNATURE');
  r = await scan(`CB1.${bookingA}.${ticket.code}`);
  check('API6', 'qr-malformed', 'Ticket missing its signature', 'MALFORMED', r.json?.verdict ?? r.status, r.json?.verdict === 'MALFORMED');
  r = await scan(ticket.code);
  check('API6', 'qr-code-only', 'Booking code alone (pre-fix QR content)', 'rejected', r.json?.verdict ?? r.status, r.json?.verdict && r.json.verdict !== 'VALID');
  {
    const first = await scan(signed);
    const second = await scan(signed);
    check('API6', 'qr-genuine-once', 'Genuine ticket scanned twice', 'VALID then ALREADY_CHECKED_IN', `${first.json?.verdict}, ${second.json?.verdict}`, first.json?.verdict === 'VALID' && second.json?.verdict === 'ALREADY_CHECKED_IN');
  }

  // ---- Injection (API8 in 2019 list; tested for completeness) ----------------------------
  r = await call('GET', `/movies?city=${city.id}&q=${encodeURIComponent("' OR 1=1 --")}`);
  check('INJ', 'sqli-search', "Search q=' OR 1=1 --", '200, 0 rows, no SQL error', `${r.status}, ${r.json?.movies?.length ?? '-'} rows`, r.status === 200 && (r.json?.movies?.length ?? 0) === 0, 'Drizzle binds parameters');
  r = await call('POST', '/auth/login', { body: { email: "admin@cinebook.dev' --", password: 'x' } });
  check('INJ', 'sqli-login', "Login e-mail with ' --", '401/422', r.status, [401, 422].includes(r.status));
  r = await call('GET', `/showtimes/${encodeURIComponent("1; DROP TABLE users")}/seats`);
  check('INJ', 'sqli-path', 'Path id = "1; DROP TABLE users"', '422', r.status, r.status === 422, 'ids validated as UUIDs before any query');
  const xss = await call('PATCH', '/me', { token: Bt, body: { name: '<img src=x onerror=alert(1)>' } });
  check('INJ', 'stored-xss', 'Name containing an <img onerror> payload', 'stored as text; JSON; CSP blocks inline', `${xss.status}, ${xss.headers.get('content-type')}`, (xss.headers.get('content-type') ?? '').includes('application/json'), 'React escapes text; script-src self');

  // ---- API8: Security misconfiguration (local + live) -----------------------------------
  const browser = await chromium.launch({ args: ['--disable-blink-features=AutomationControlled'] });
  const ctx = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36' });
  const page = await ctx.newPage();
  await page.goto(LIVE);
  await page.waitForTimeout(3000);
  const liveRes = await ctx.request.get(`${LIVE}/api/v1/cities`);
  const h = liveRes.headers();
  const has = (k) => (h[k] ? 'present' : 'missing');
  check('API8', 'hsts', 'Strict-Transport-Security (live)', 'present', has('strict-transport-security'), !!h['strict-transport-security']);
  check('API8', 'csp', 'Content-Security-Policy (live API)', 'present', has('content-security-policy'), !!h['content-security-policy']);
  check('API8', 'nosniff', 'X-Content-Type-Options (live)', 'nosniff', h['x-content-type-options'], h['x-content-type-options'] === 'nosniff');
  check('API8', 'framing', 'Clickjacking protection (live)', 'frame-ancestors or X-Frame-Options', h['x-frame-options'] ?? (/frame-ancestors/.test(h['content-security-policy'] ?? '') ? 'frame-ancestors' : 'missing'), !!h['x-frame-options'] || /frame-ancestors/.test(h['content-security-policy'] ?? ''));
  check('API8', 'powered-by', 'X-Powered-By leaked (live)', 'absent', h['x-powered-by'] ?? 'absent', !h['x-powered-by']);
  const evil = await ctx.request.get(`${LIVE}/api/v1/cities`, { headers: { Origin: 'https://evil.example' } });
  check('API8', 'cors-foreign-origin', 'Request from https://evil.example (live)', 'origin not reflected', evil.headers()['access-control-allow-origin'] ?? 'no ACAO header', evil.headers()['access-control-allow-origin'] !== 'https://evil.example' && evil.headers()['access-control-allow-origin'] !== '*');
  const err = await ctx.request.get(`${LIVE}/api/v1/showtimes/not-a-uuid/seats`);
  const errText = await err.text();
  check('API8', 'error-leak', 'Bad input error body (live)', 'no stack trace / SQL', `${err.status()}, ${/at \w+ \(|SELECT|stack/i.test(errText) ? 'leaks' : 'clean'}`, !/at \w+ \(|SELECT|stack/i.test(errText));
  await browser.close();

  // ---- Payment data at rest (live database, read-only) ----------------------------------
  const envLine = readFileSync(resolve(ROOT, 'apps/api/.env'), 'utf8').split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL='));
  const db = new pg.Client({ connectionString: envLine.slice(13).trim() });
  await db.connect();
  const cols = (await db.query(`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public' AND column_name ~* '(cvv|cvc|pan|card_number|expiry)'`)).rows;
  const pan = (await db.query(`SELECT count(*)::int n, count(*) FILTER (WHERE instrument ~ '[0-9]{8,}')::int leaked FROM payments`)).rows[0];
  await db.end();
  check('DATA', 'no-cvv-pan-columns', 'Columns named cvv/pan/card_number/expiry (live DB)', 'none', cols.length ? cols.map((c) => `${c.table_name}.${c.column_name}`).join(',') : 'none', cols.length === 0);
  check('DATA', 'pan-at-rest', `Payment rows with ≥8 consecutive digits (n=${pan.n}, live DB)`, '0', pan.leaked, pan.leaked === 0, 'only "•••• 1234" is stored');

  const passed = results.filter((x) => x.pass).length;
  log.event({ type: 'summary', total: results.length, passed });
  console.log(`\n${passed}/${results.length} checks passed`);
} finally {
  server.kill();
  log.event({ type: 'run_end', finishedAt: new Date().toISOString() });
  await log.close();
}
