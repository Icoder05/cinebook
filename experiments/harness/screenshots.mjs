// Screenshots of the deployed CineBook for the report (home, showtimes, seat map, ticket).
//   node experiments/harness/screenshots.mjs
// Makes one booking with a research account, captures the ticket, then deletes the
// account and booking so the live data is left as found.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { ensure, FIGURES, ROOT } from './paths.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('@playwright/test');
const pg = require('pg');
const BASE = 'https://cinebook-eight-chi.vercel.app';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const OUT = ensure(resolve(FIGURES, 'screens'));
const email = `research+screens-${Date.now()}@cinebook.test`;

const browser = await chromium.launch({ args: ['--disable-blink-features=AutomationControlled'] });
const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1.5 });
const page = await ctx.newPage();
const shot = (name) => page.screenshot({ path: resolve(OUT, `${name}.png`) });
try {
  await page.goto(BASE);
  await page.waitForTimeout(3000);
  const r = await ctx.request.post(`${BASE}/api/v1/auth/signup`, { data: { name: 'Report Screens', email, phone: '9876543210', password: 'research123' } });
  if (r.status() !== 201) throw new Error(`signup ${r.status()}`);
  await ctx.clearCookies({ name: 'cb_rt' });
  await page.goto(`${BASE}/login`);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('research123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('heading', { name: 'Now Showing' }).waitFor();
  const city = page.getByRole('dialog');
  if (await city.isVisible().catch(() => false)) await city.getByRole('button', { name: /^Bengaluru/ }).click();
  await page.waitForTimeout(4500); // let the welcome toast disappear and posters load
  await shot('1_home');

  await page.locator('section[aria-labelledby="now-showing"] a').first().click();
  await page.getByRole('link', { name: 'Book tickets' }).click();
  await page.locator('a[href^="/showtimes/"]').first().waitFor();
  await page.waitForTimeout(1500);
  await shot('2_showtimes');

  await page.locator('a[href^="/showtimes/"]').first().click();
  const picker = page.getByRole('dialog', { name: 'How many seats?' });
  await picker.waitFor();
  await page.waitForTimeout(800);
  await shot('3_seat_count');
  await picker.getByRole('radio', { name: '2', exact: true }).click();
  await picker.getByRole('button', { name: /^Select \d+ seats?$/ }).click();
  const map = page.getByRole('group', { name: 'Seat map' });
  const free = map.locator('button[aria-label*=", available"]');
  await free.nth(Math.floor((await free.count()) / 2)).click();
  await page.waitForTimeout(800);
  await shot('4_seat_map');

  await page.getByRole('button', { name: /^Pay/ }).click();
  await page.getByRole('heading', { name: 'Booking summary' }).waitFor();
  await page.waitForTimeout(800);
  await shot('5_summary');
  await page.getByRole('link', { name: /Proceed to pay/ }).click();
  await page.getByLabel('Card number').fill('4242424242424242');
  await page.getByLabel('Name on card').fill('Report Screens');
  await page.getByLabel('Expiry (MM/YY)').fill('1239');
  await page.getByLabel('CVV').fill('123');
  await page.getByRole('button', { name: 'Pay securely' }).click();
  await page.getByText('Booking confirmed!').waitFor({ timeout: 20_000 });
  await page.waitForTimeout(1500);
  await shot('6_ticket');
  console.log('screenshots written to', OUT);
} finally {
  await browser.close();
  const url = readFileSync(resolve(ROOT, 'apps/api/.env'), 'utf8').split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL=')).slice(13).trim();
  const db = new pg.Client({ connectionString: url });
  await db.connect();
  await db.query('BEGIN');
  const ids = (await db.query('SELECT id FROM users WHERE email = $1', [email])).rows.map((x) => x.id);
  const b = (await db.query('SELECT id FROM bookings WHERE user_id = ANY($1::uuid[])', [ids])).rows.map((x) => x.id);
  await db.query(`UPDATE show_seats SET status='AVAILABLE', held_by=NULL, hold_id=NULL, hold_expires_at=NULL, booking_id=NULL
                  WHERE held_by = ANY($1::uuid[]) OR booking_id = ANY($2::uuid[]) OR hold_id = ANY($2::uuid[])`, [ids, b]);
  await db.query('DELETE FROM payments WHERE booking_id = ANY($1::uuid[])', [b]);
  await db.query('DELETE FROM bookings WHERE id = ANY($1::uuid[])', [b]);
  await db.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [ids]);
  await db.query('COMMIT');
  await db.end();
  console.log(`cleanup: ${ids.length} user, ${b.length} booking`);
}
