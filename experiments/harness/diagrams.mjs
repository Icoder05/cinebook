// Report diagrams: methodology flowchart, system architecture, and a 2×2 panel of app
// screenshots. Plain black-and-grey line drawings, rendered to PNG with Chromium.
//   node experiments/harness/diagrams.mjs   (run screenshots.mjs first for the panel)
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { ensure, FIGURES } from './paths.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('@playwright/test');
const OUT = ensure(resolve(FIGURES, 'report'));

const css = `
  body { margin: 0; background: #fff; font-family: Calibri, Carlito, Arial, sans-serif; color: #000; }
  .box { position: absolute; border: 1.6px solid #000; background: #fff; text-align: center; display: flex;
         align-items: center; justify-content: center; font-size: 17px; line-height: 1.25; padding: 4px 10px; box-sizing: border-box; }
  .box b { display: block; font-size: 17px; }
  .box small { display: block; font-size: 14px; color: #333; }
  .grey { background: #f2f2f2; }
  .group { position: absolute; border: 1.4px dashed #555; }
  .glabel { position: absolute; font-size: 15px; font-style: italic; color: #333; background: #fff; padding: 0 6px; }
  svg { position: absolute; left: 0; top: 0; }
`;
const arrowDefs = `<defs><marker id="a" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 z" fill="#000"/></marker></defs>`;
const line = (x1, y1, x2, y2, dash = false) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#000" stroke-width="1.6" ${dash ? 'stroke-dasharray="5,4"' : ''} marker-end="url(#a)"/>`;
const poly = (pts) => `<polyline points="${pts}" fill="none" stroke="#000" stroke-width="1.6" marker-end="url(#a)"/>`;
const box = (x, y, w, h, html, cls = '') => `<div class="box ${cls}" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px">${html}</div>`;

// ---- Flowchart: the research process -------------------------------------------------
function flowchart() {
  const W = 900;
  const H = 860;
  const cx = 300;
  const bw = 420;
  const steps = [
    ['1. Problem identification', 'Can a small, focused booking site match established platforms, and does it book reliably?'],
    ['2. Research objectives', 'O1 web performance · O2 booking workflow and accessibility · O3 reliability under load'],
    ['3. Experimental design', 'KPIs, baselines, tools, test conditions and repetitions'],
    ['4. Experiment execution', 'repeated automated tests; every raw measurement logged'],
    ['5. Data analysis', 'Excel workbook: mean, SD, CI, percentiles, tests and charts'],
    ['6. Interpretation', 'what do the results tell us?'],
    ['7. Conclusion and improvements', 'what did we learn and what comes next?'],
  ];
  const bh = 78;
  const gap = 38;
  let html = '';
  let svg = '';
  steps.forEach(([t, sub], i) => {
    const y = 20 + i * (bh + gap);
    html += box(cx - bw / 2, y, bw, bh, `<div><b>${t}</b><small>${sub}</small></div>`, i === 5 ? 'grey' : '');
    if (i < steps.length - 1) svg += line(cx, y + bh, cx, y + bh + gap - 2);
  });
  // From interpretation: a defect found -> fix CineBook -> run the experiment again.
  const y6 = 20 + 5 * (bh + gap) + bh / 2;
  const y4 = 20 + 3 * (bh + gap) + bh / 2;
  const dx = 705;
  svg += `<polygon points="${dx},${y6 - 50} ${dx + 100},${y6} ${dx},${y6 + 50} ${dx - 100},${y6}" fill="#fff" stroke="#000" stroke-width="1.6"/>`;
  html += `<div style="position:absolute;left:${dx - 80}px;top:${y6 - 22}px;width:160px;text-align:center;font-size:16px">Defect<br>found?</div>`;
  svg += line(cx + bw / 2, y6, dx - 102, y6);
  html += box(dx - 95, y4 - 39, 190, 78, '<div><b>Fix CineBook</b><small>new iteration</small></div>');
  svg += line(dx, y6 - 50, dx, y4 + 41);
  svg += line(dx - 95, y4, cx + bw / 2 + 2, y4);
  html += `<div style="position:absolute;left:${dx + 8}px;top:${y6 - 95}px;font-size:15px">yes</div>`;
  html += `<div style="position:absolute;left:${cx + 10}px;top:${y6 + bh / 2 + 6}px;font-size:15px">no</div>`;
  return { W, H, html: `<svg width="${W}" height="${H}">${arrowDefs}${svg}</svg>${html}` };
}

// ---- Booking workflow --------------------------------------------------------------------
function workflow() {
  const W = 1180;
  const H = 330;
  const steps = [
    ['Sign in', 'e-mail and password'], ['Choose city', 'remembered after first visit'], ['Browse films', 'filter by language, genre, format'],
    ['Pick show', 'theatre, date, time'], ['How many seats?', '1 to 10 tickets'],
    ['Select seats', 'seat map'], ['Seats held', 'for 10 minutes'], ['Booking summary', 'price, fee and GST shown'],
    ['Pay', 'test gateway'], ['Ticket', 'QR code, booking ID'],
  ];
  const bw = 190;
  const bh = 92;
  const gx = 42;
  let html = '';
  let svg = '';
  steps.forEach(([t, sub], i) => {
    const row = i < 5 ? 0 : 1;
    const k = row === 0 ? i : 9 - i; // second row runs right to left
    const x = 20 + k * (bw + gx);
    const y = 20 + row * 190;
    html += box(x, y, bw, bh, `<div><b>${t}</b><small>${sub}</small></div>`, i === 6 ? 'grey' : '');
    if (i < 4) svg += line(x + bw, y + bh / 2, x + bw + gx - 2, y + bh / 2);
    if (i >= 5 && i < 9) svg += line(x, y + bh / 2, x - gx + 2, y + bh / 2);
  });
  const xLast = 20 + 4 * (bw + gx) + bw / 2;
  svg += line(xLast, 20 + bh, xLast, 20 + 190 - 2);
  html += `<div style="position:absolute;left:${20 + 3 * (bw + gx) - 10}px;top:${20 + 190 + bh + 8}px;width:${bw + 60}px;text-align:center;font-size:14px;font-style:italic">if the hold expires, the seats are released</div>`;
  return { W, H, html: `<svg width="${W}" height="${H}">${arrowDefs}${svg}</svg>${html}` };
}

// ---- Database design (main tables only) ----------------------------------------------------
function database() {
  const W = 1180;
  const H = 520;
  const t = (x, y, w, name, fields, grey = false) =>
    `<div style="position:absolute;left:${x}px;top:${y}px;width:${w}px;border:1.6px solid #000;background:#fff;font-size:15px">
       <div style="background:${grey ? '#d9d9d9' : '#f2f2f2'};border-bottom:1.2px solid #000;padding:4px 8px;font-weight:bold">${name}</div>
       <div style="padding:4px 8px;line-height:1.35">${fields.join('<br>')}</div></div>`;
  let html = '';
  html += t(20, 20, 200, 'theatres', ['id', 'city', 'name, address']);
  html += t(20, 200, 200, 'screens', ['id', 'theatre_id', 'layout']);
  html += t(20, 360, 200, 'seats', ['id', 'screen_id', 'row, number, tier']);
  html += t(300, 20, 210, 'movies', ['id', 'title, languages, genres', 'poster, rating']);
  html += t(300, 200, 210, 'showtimes', ['id', 'movie_id, screen_id', 'starts_at, language, format']);
  html += t(590, 160, 250, 'show_seats', ['showtime_id + seat_id (key)', '<b>status</b>: AVAILABLE / HELD / BOOKED', 'held_by, hold_expires_at', 'booking_id'], true);
  html += t(590, 360, 250, 'bookings', ['id, code', 'user_id, showtime_id', 'status, total', 'checked_in_at'], true);
  html += t(920, 360, 230, 'payments', ['id, booking_id', '<b>idempotency_key</b> (unique)', 'status, amount']);
  html += t(920, 160, 230, 'users', ['id', 'name, e-mail, role', 'password hash']);
  let svg = '';
  const ln = (x1, y1, x2, y2) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#000" stroke-width="1.5"/>`;
  svg += ln(120, 116, 120, 200) + ln(120, 296, 120, 360);
  svg += ln(405, 116, 405, 200) + ln(220, 240, 300, 240);
  svg += ln(510, 230, 590, 230);
  svg += `<polyline points="220,420 555,420 555,262 590,262" fill="none" stroke="#000" stroke-width="1.5"/>`;
  svg += ln(715, 278, 715, 360) + ln(840, 420, 920, 420);
  svg += `<polyline points="1035,258 1035,320 880,320 880,385 840,385" fill="none" stroke="#000" stroke-width="1.5"/>`;
  return { W, H, html: `<svg width="${W}" height="${H}">${svg}</svg>${html}<div style="position:absolute;left:20px;top:490px;font-size:14px;font-style:italic">Grey: tables at the centre of seat holding and booking. Lines link tables that refer to each other.</div>` };
}

// ---- Architecture ----------------------------------------------------------------------
function architecture() {
  const W = 1000;
  const H = 560;
  let html = '';
  let svg = '';
  html += box(30, 210, 170, 100, '<div><b>User</b><small>web browser<br>(desktop / mobile)</small></div>');
  html += `<div class="group" style="left:282px;top:40px;width:386px;height:440px"></div><div class="glabel" style="left:300px;top:30px">Vercel (cloud hosting)</div>`;
  html += box(300, 80, 350, 100, '<div><b>CDN: React web application</b><small>static HTML, JavaScript, CSS, images</small></div>');
  html += box(300, 300, 350, 140, '<div><b>Serverless API (Express, Node.js)</b><small>catalogue · seat holds · payments (test mode)<br>tickets · authentication<br>region: Singapore</small></div>');
  html += box(760, 300, 210, 140, '<div><b>PostgreSQL database</b><small>Neon, Singapore<br>movies, shows, seats,<br>bookings, payments</small></div>', 'grey');
  html += box(760, 80, 210, 100, '<div><b>TMDB</b><small>film posters and<br>metadata (images)</small></div>');
  svg += line(200, 240, 298, 140);
  svg += line(200, 280, 298, 360);
  svg += `<text x="200" y="196" font-size="14" font-family="Calibri">pages</text><text x="196" y="332" font-size="14" font-family="Calibri">/api/v1</text>`;
  svg += line(650, 370, 758, 370);
  svg += `<text x="676" y="360" font-size="14" font-family="Calibri">SQL (pooled)</text>`;
  svg += line(650, 130, 758, 130, true);
  svg += `<text x="678" y="120" font-size="14" font-family="Calibri">poster links</text>`;
  html += box(300, 490, 350, 56, '<div><small>Measurement tools: Playwright (Chromium), axe-core, Node.js scripts, Excel</small></div>', 'grey');
  return { W, H, html: `<svg width="${W}" height="${H}">${arrowDefs}${svg}</svg>${html}` };
}

// ---- Screenshot panel ------------------------------------------------------------------
function panel() {
  const W = 1600;
  const H = 1060;
  const img = (f) => `data:image/png;base64,${readFileSync(resolve(FIGURES, 'screens', f)).toString('base64')}`;
  const cell = (x, y, f, label) => `<div style="position:absolute;left:${x}px;top:${y}px;width:780px">
    <img src="${img(f)}" style="width:780px;border:1px solid #999;display:block">
    <div style="font-size:22px;text-align:center;margin-top:6px">${label}</div></div>`;
  return {
    W, H,
    html: cell(10, 10, '1_home.png', '(a) Home page with filters') + cell(810, 10, '2_showtimes.png', '(b) Theatres and showtimes')
      + cell(10, 540, '4_seat_map.png', '(c) Seat map with two seats selected') + cell(810, 540, '6_ticket.png', '(d) Confirmed ticket with QR code'),
  };
}

function panelExtra() {
  const W = 1600;
  const H = 540;
  const img = (f) => `data:image/png;base64,${readFileSync(resolve(FIGURES, 'screens', f)).toString('base64')}`;
  const cell = (x, f, label) => `<div style="position:absolute;left:${x}px;top:10px;width:780px">
    <img src="${img(f)}" style="width:780px;border:1px solid #999;display:block">
    <div style="font-size:22px;text-align:center;margin-top:6px">${label}</div></div>`;
  return { W, H, html: cell(10, '3_seat_count.png', '(a) "How many seats?" dialog') + cell(810, '5_summary.png', '(b) Booking summary with the 10-minute hold timer') };
}

const browser = await chromium.launch();
for (const [name, fn, scale] of [['flowchart', flowchart, 2], ['architecture', architecture, 2], ['workflow', workflow, 2], ['database', database, 2], ['screens', panel, 1], ['screens_extra', panelExtra, 1]]) {
  const { W, H, html } = fn();
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: scale });
  await page.setContent(`<!doctype html><html><head><style>${css}</style></head><body><div style="position:relative;width:${W}px;height:${H}px">${html}</div></body></html>`);
  await page.screenshot({ path: resolve(OUT, `${name}.png`) });
  await page.close();
  console.log('wrote', name);
}
await browser.close();
