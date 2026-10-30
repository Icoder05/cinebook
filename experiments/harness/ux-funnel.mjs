// E7: booking-funnel instrumentation on the deployed CineBook (desktop + mobile), a
// Keystroke-Level Model (KLM) estimate of expert human time, and a keyboard-only booking.
//   node experiments/harness/ux-funnel.mjs [--run name] [--trials 5]
// Robot timings measure the system (rendering + network), not people; human time is
// estimated with KLM (Card, Moran & Newell 1980). SUS needs real participants: see
// experiments/ux/ for the questionnaire, data sheet and scoring script.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { createLogger } from './log.mjs';
import { CONFIG, ROOT } from './paths.mjs';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('@playwright/test');
const pg = require('pg');
const config = JSON.parse(readFileSync(CONFIG, 'utf8'));
const BASE = config.live.baseUrl;
const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const RUN_ID = opt('run', 'ux-funnel');
const TRIALS = Number(opt('trials', 5));
const tag = RUN_ID.replace(/[^a-z0-9-]/gi, '').toLowerCase();
const log = createLogger(RUN_ID);
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
// KLM operator times in seconds (Card, Moran & Newell 1980; K for an average typist).
const KLM = { K: 0.28, P: 1.1, B: 0.1, H: 0.4, M: 1.35 };
let userNo = 0;

const browser = await chromium.launch({ args: ['--disable-blink-features=AutomationControlled'] });
log.manifest({ runId: RUN_ID, startedAt: new Date().toISOString(), baseUrl: BASE, trials: TRIALS, klm: KLM });
log.event({ type: 'run_start', runId: RUN_ID, totalCells: 3 });

async function newUser(ctx) {
  const n = userNo++;
  const email = `research+${tag}-${n}@cinebook.test`;
  const r = await ctx.request.post(`${BASE}/api/v1/auth/signup`, { data: { name: 'UX Research', email, phone: '9876543210', password: 'research123' }, failOnStatusCode: false });
  if (r.status() !== 201) throw new Error(`signup ${r.status()}`);
  // Signing up also signs the context in; drop that session so the funnel starts signed out.
  await ctx.clearCookies({ name: 'cb_rt' });
  return email;
}

/** Wraps a page so every user action is counted, typed into a KLM sequence and timed. */
function instrument(page) {
  const s = { clicks: 0, keys: 0, fields: 0, screens: new Set(), dialogs: 0, klm: [], marks: {}, klmAt: {} };
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) s.screens.add(new URL(f.url()).pathname.replace(/[0-9a-f-]{36}/g, ':id')); });
  return {
    s,
    async click(loc) { await loc.click(); s.clicks++; s.klm.push('M', 'P', 'B', 'B'); },
    async fill(loc, text) { await loc.click(); await loc.fill(text); s.clicks++; s.fields++; s.keys += text.length; s.klm.push('M', 'P', 'B', 'B', 'H', ...Array(text.length).fill('K'), 'H'); },
    mark(name) { s.marks[name] = performance.now(); s.klmAt[name] = s.klm.length; },
  };
}
const klmSeconds = (ops) => ops.reduce((t, o) => t + KLM[o], 0);

async function holdSeats(page, ui, count) {
  const picker = page.getByRole('dialog', { name: 'How many seats?' });
  await ui.click(picker.getByRole('radio', { name: String(count), exact: true }));
  await ui.click(picker.getByRole('button', { name: /^Select \d+ seats?$/ }));
  ui.s.dialogs++;
  const map = page.getByRole('group', { name: 'Seat map' });
  for (let attempt = 0; attempt < 5; attempt++) {
    const selected = map.locator('button[aria-pressed="true"]');
    while ((await selected.count()) < count) {
      const free = map.locator('button[aria-label*=", available"]');
      await ui.click(free.nth(Math.floor(Math.random() * (await free.count()))));
    }
    await ui.click(page.getByRole('button', { name: /^Pay/ }));
    if (await page.getByRole('heading', { name: 'Booking summary' }).waitFor({ timeout: 6000 }).then(() => true).catch(() => false)) return attempt;
  }
  throw new Error('could not hold seats');
}

async function funnel(deviceName, trial) {
  const device = deviceName === 'mobile' ? devices['Pixel 7'] : { viewport: { width: 1366, height: 860 }, userAgent: UA };
  const ctx = await browser.newContext({ ...device });
  const page = await ctx.newPage();
  await page.goto(BASE);
  await page.waitForTimeout(3000);
  const email = await newUser(ctx);
  const ui = instrument(page);
  const t0 = performance.now();
  // 1. Sign in
  await page.goto(`${BASE}/login`);
  await ui.fill(page.getByLabel('Email'), email);
  await ui.fill(page.getByLabel('Password', { exact: true }), 'research123');
  await ui.click(page.getByRole('button', { name: 'Sign in' }));
  await page.getByRole('heading', { name: 'Now Showing' }).waitFor();
  ui.mark('signedIn');
  // 2. Discovery: city, then a film
  const cityDialog = page.getByRole('dialog');
  if (await cityDialog.isVisible().catch(() => false)) { await ui.click(cityDialog.getByRole('button', { name: /^Bengaluru/ })); ui.s.dialogs++; }
  await ui.click(page.locator('section[aria-labelledby="now-showing"] a').first());
  ui.mark('movie');
  // 3. Theatre + showtime
  await ui.click(page.getByRole('link', { name: 'Book tickets' }));
  await ui.click(page.locator('a[href^="/showtimes/"]').first());
  await page.getByRole('group', { name: 'Seat map' }).waitFor();
  ui.mark('seatMap');
  // 4. Seats
  const retries = await holdSeats(page, ui, 2);
  ui.mark('summary');
  // 5. Checkout
  await ui.click(page.getByRole('link', { name: /Proceed to pay/ }));
  await ui.fill(page.getByLabel('Card number'), '4242424242424242');
  await ui.fill(page.getByLabel('Name on card'), 'UX Research');
  await ui.fill(page.getByLabel('Expiry (MM/YY)'), '1239');
  await ui.fill(page.getByLabel('CVV'), '123');
  await ui.click(page.getByRole('button', { name: 'Pay securely' }));
  await page.getByText('Booking confirmed!').waitFor({ timeout: 20_000 });
  ui.mark('confirmed');
  const total = performance.now() - t0;
  const pricingVisible = await page.getByText(/Convenience fee|GST|Taxes/i).first().isVisible().catch(() => false);
  const ms = (a, b) => +((ui.s.marks[b] - (a ? ui.s.marks[a] : t0)) / 1000).toFixed(2);
  const row = {
    exp: 'E7', strategy: `CineBook ${deviceName}`, device: deviceName, c: 1, trial,
    screens: ui.s.screens.size, dialogs: ui.s.dialogs, clicks: ui.s.clicks, keystrokes: ui.s.keys, formFields: ui.s.fields, seatRetries: retries,
    robotSec: +(total / 1000).toFixed(2), klmSec: +klmSeconds(ui.s.klm).toFixed(1),
    klmAfterSignInSec: +klmSeconds(ui.s.klm.slice(ui.s.klmAt.signedIn)).toFixed(1),
    klmCheckoutSec: +klmSeconds(ui.s.klm.slice(ui.s.klmAt.summary)).toFixed(1),
    stageSignIn: ms(null, 'signedIn'), stageDiscovery: ms('signedIn', 'movie'), stageShowtime: ms('movie', 'seatMap'), stageSeats: ms('seatMap', 'summary'), stageCheckout: ms('summary', 'confirmed'),
    feeBreakdownBeforePay: pricingVisible, screenList: [...ui.s.screens].join(' > '),
  };
  log.trial(row);
  console.log(`E7 ${deviceName} #${trial}: ${row.screens} screens, ${row.clicks} clicks, ${row.keystrokes} keys, robot ${row.robotSec}s, KLM ${row.klmSec}s`);
  await ctx.close();
}

/** Keyboard only: Tab / Shift+Tab / Enter / Space / typing; checks a visible focus ring at each stop. */
async function keyboardOnly(trial) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 860 }, userAgent: UA });
  const page = await ctx.newPage();
  await page.goto(BASE);
  await page.waitForTimeout(3000);
  const email = await newUser(ctx);
  let tabs = 0;
  let stops = 0;
  let tabsBeforeSeats = 0;
  let tabsSeatMap = null;
  let arrowPresses = 0;
  let invisibleFocus = 0;
  const failures = [];
  const focusVisible = () => page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return true;
    const cs = getComputedStyle(el);
    return (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || cs.boxShadow !== 'none';
  });
  async function tabTo(test, label, max = 250, arg = null) {
    for (let i = 0; i < max; i++) {
      await page.keyboard.press('Tab');
      tabs++;
      if (await page.evaluate(test, arg).catch(() => false)) {
        stops++;
        if (!(await focusVisible())) invisibleFocus++;
        return true;
      }
    }
    const where = await page.evaluate(() => `${location.pathname} @ ${document.activeElement?.tagName}.${(document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent ?? '').trim().slice(0, 40)}`).catch(() => '?');
    failures.push(`${label} (stuck at ${where})`);
    throw new Error(`keyboard: could not reach ${label}`);
  }
  // Like a person, wait for the new screen to settle after each activation.
  const enter = async () => { await page.keyboard.press('Enter'); await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(1200); };
  const t0 = performance.now();
  let completed = false;
  try {
    await page.goto(`${BASE}/login`);
    await tabTo(() => document.activeElement?.id === 'email', 'email'); await page.keyboard.type(email);
    await tabTo(() => document.activeElement?.id === 'password', 'password'); await page.keyboard.type('research123');
    await enter();
    await page.getByRole('heading', { name: 'Now Showing' }).waitFor();
    const city = page.getByRole('dialog');
    if (await city.isVisible().catch(() => false)) {
      await tabTo(() => /^Bengaluru/.test(document.activeElement?.textContent?.trim() ?? ''), 'city');
      await enter();
    }
    await tabTo(() => !!document.activeElement?.closest('section[aria-labelledby="now-showing"]') && document.activeElement.tagName === 'A', 'first film');
    await enter();
    await tabTo(() => /Book tickets/i.test(document.activeElement?.textContent ?? ''), 'Book tickets', 400);
    await enter();
    await tabTo(() => document.activeElement?.getAttribute('href')?.startsWith('/showtimes/'), 'showtime', 500);
    await enter();
    await page.getByRole('dialog', { name: 'How many seats?' }).waitFor();
    // Radio group: arrow keys move between counts (1 → 2), then Tab to the confirm button.
    await tabTo(() => document.activeElement?.getAttribute('role') === 'radio' || document.activeElement?.type === 'radio', 'seat-count radio');
    await page.keyboard.press('ArrowRight');
    await tabTo(() => /^Select \d+ seats?$/.test(document.activeElement?.textContent?.trim() ?? ''), 'Select seats');
    await enter();
    tabsBeforeSeats = tabs;
    await tabTo(() => /, available/.test(document.activeElement?.getAttribute('aria-label') ?? ''), 'free seat', 1000);
    await enter();
    // If the chosen seat had no free neighbour only one seat is picked: arrow on and add another.
    let arrows = 0;
    const map = page.getByRole('group', { name: 'Seat map' });
    while ((await map.locator('button[aria-pressed="true"]').count()) < 2 && arrows < 40) {
      await page.keyboard.press('ArrowRight');
      arrows++;
      if ((await page.evaluate(() => document.activeElement?.getAttribute('aria-pressed'))) === 'false') await page.keyboard.press('Enter');
    }
    arrowPresses = arrows;
    await tabTo(() => /^Pay/.test(document.activeElement?.textContent?.trim() ?? ''), 'Pay button', 1000);
    tabsSeatMap = tabs - tabsBeforeSeats;
    await enter();
    await page.getByRole('heading', { name: 'Booking summary' }).waitFor({ timeout: 8000 });
    await tabTo(() => /Proceed to pay/.test(document.activeElement?.textContent ?? ''), 'Proceed to pay');
    await enter();
    for (const [label, text] of [['Card number', '4242424242424242'], ['Name on card', 'UX Research'], ['Expiry (MM/YY)', '1239'], ['CVV', '123']]) {
      await tabTo((l) => !!document.activeElement?.labels?.[0]?.textContent?.includes(l), label, 250, label);
      await page.keyboard.type(text);
    }
    await tabTo(() => document.activeElement?.textContent?.trim() === 'Pay securely', 'Pay securely');
    await enter();
    await page.getByText('Booking confirmed!').waitFor({ timeout: 20_000 });
    completed = true;
  } catch (e) {
    if (!failures.length) failures.push(String(e.message).slice(0, 100));
  }
  const row = { exp: 'E7-keyboard', strategy: 'CineBook keyboard-only', c: 1, trial, completed, tabs, stops, invisibleFocus, tabsSeatMap, arrowPresses, failedAt: failures.join('; ') || null, robotSec: +((performance.now() - t0) / 1000).toFixed(2) };
  log.trial(row);
  console.log(`E7 keyboard #${trial}: completed=${completed} tabs=${tabs} stops=${stops} invisibleFocus=${invisibleFocus} ${row.failedAt ?? ''}`);
  await ctx.close();
}

try {
  for (const d of ['desktop', 'mobile']) {
    log.event({ type: 'cell_start', exp: 'E7', strategy: `CineBook ${d}`, c: 1 });
    for (let t = 0; t < TRIALS; t++) {
      try { await funnel(d, t); } catch (e) { log.trial({ exp: 'E7', strategy: `CineBook ${d}`, trial: t, error: String(e.message).slice(0, 160) }); console.log(`E7 ${d} #${t} error: ${e.message}`); }
    }
  }
  log.event({ type: 'cell_start', exp: 'E7-keyboard', strategy: 'keyboard-only', c: 1 });
  for (let t = 0; t < 3; t++) await keyboardOnly(t);
} finally {
  // Cleanup: research accounts and their bookings; seats returned to AVAILABLE.
  const url = readFileSync(resolve(ROOT, 'apps/api/.env'), 'utf8').split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL=')).slice(13).trim();
  const db = new pg.Client({ connectionString: url });
  await db.connect();
  await db.query('BEGIN');
  const ids = (await db.query('SELECT id FROM users WHERE email LIKE $1', [`research+${tag}-%@cinebook.test`])).rows.map((r) => r.id);
  const b = (await db.query('SELECT id FROM bookings WHERE user_id = ANY($1::uuid[])', [ids])).rows.map((r) => r.id);
  await db.query(`UPDATE show_seats SET status='AVAILABLE', held_by=NULL, hold_id=NULL, hold_expires_at=NULL, booking_id=NULL
                  WHERE held_by = ANY($1::uuid[]) OR booking_id = ANY($2::uuid[]) OR hold_id = ANY($2::uuid[])`, [ids, b]);
  await db.query('DELETE FROM payments WHERE booking_id = ANY($1::uuid[])', [b]);
  await db.query('DELETE FROM bookings WHERE id = ANY($1::uuid[])', [b]);
  await db.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [ids]);
  await db.query('COMMIT');
  await db.end();
  console.log(`cleanup: removed ${ids.length} users, ${b.length} bookings`);
  log.event({ type: 'run_end', finishedAt: new Date().toISOString() });
  await log.close();
  await browser.close();
}
