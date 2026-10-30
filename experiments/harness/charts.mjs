// Renders the figures (PNG) in figures/ from data/processed/*.csv with Chart.js in headless Chromium.
//   node experiments/harness/charts.mjs            (report style: no embedded titles)
//   node experiments/harness/charts.mjs --titled   (slide style with titles → figures/titled/)
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIGURES, PROCESSED } from './paths.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('@playwright/test');
const A = PROCESSED;
const F = process.argv.includes('--titled') ? resolve(FIGURES, 'titled') : FIGURES;
mkdirSync(F, { recursive: true });

function readCsv(name) {
  const p = resolve(A, name);
  if (!existsSync(p)) return [];
  const [head, ...lines] = readFileSync(p, 'utf8').trim().split('\n');
  const cols = head.split(',');
  return lines.map((l) => {
    const v = l.match(/("([^"]|"")*"|[^,]*)(,|$)/g).map((x) => x.replace(/,$/, '').replace(/^"|"$/g, ''));
    return Object.fromEntries(cols.map((c, i) => [c, v[i] === '' || isNaN(+v[i]) ? v[i] : +v[i]]));
  });
}

const COLORS = {
  naive: '#d92d20', conditional_update: '#F84464', pessimistic_sorted: '#2e90fa', pessimistic_unordered: '#7a5af8',
  optimistic_version: '#12b76a', serializable: '#f79009', advisory_lock: '#667085',
};
const ORDER = Object.keys(COLORS);
const label = (s) => s.replace(/_/g, ' ');

const figures = [];

// Fig 1 — double bookings per trial vs concurrency (E1)
{
  const rows = readCsv('e1_hot_seat.csv');
  const cs = [...new Set(rows.map((r) => r.concurrency))].sort((a, b) => a - b);
  figures.push({
    file: 'fig1_double_bookings.png',
    title: 'Fig. 1 — Double bookings per trial vs. concurrent clients (E1, one hot seat)',
    config: {
      type: 'line',
      data: {
        labels: cs.map(String),
        datasets: ORDER.filter((s) => rows.some((r) => r.strategy === s)).map((s) => ({
          label: label(s), borderColor: COLORS[s], backgroundColor: COLORS[s], borderWidth: s === 'naive' ? 3 : 2,
          borderDash: s === 'naive' ? [] : [4, 3],
          data: cs.map((c) => rows.find((r) => r.strategy === s && r.concurrency === c)?.double_bookings_per_trial ?? null),
        })),
      },
      options: { scales: { x: { title: { display: true, text: 'concurrent clients (c)' } }, y: { title: { display: true, text: 'mean double bookings per trial' }, beginAtZero: true } } },
    },
  });
  // Fig 2 — p95 latency by strategy & concurrency (E1)
  figures.push({
    file: 'fig2_hot_seat_latency.png',
    title: 'Fig. 2 — p95 transaction latency under contention (E1), log scale',
    config: {
      type: 'bar',
      data: {
        labels: ORDER.filter((s) => rows.some((r) => r.strategy === s)).map(label),
        datasets: cs.map((c, i) => ({
          label: `c = ${c}`, backgroundColor: ['#d0d5dd', '#98a2b3', '#475467', '#1d2939'][i],
          data: ORDER.filter((s) => rows.some((r) => r.strategy === s)).map((s) => rows.find((r) => r.strategy === s && r.concurrency === c)?.latency_p95_ms ?? null),
        })),
      },
      options: { scales: { y: { type: 'logarithmic', title: { display: true, text: 'p95 latency (ms)' } } } },
    },
  });
}

// Fig 3 — outcome mix (E2)
{
  const rows = readCsv('e2_multi_seat.csv');
  const ss = ORDER.filter((s) => rows.some((r) => r.strategy === s));
  const kinds = [['success', '#12b76a'], ['conflict', '#98a2b3'], ['serialization_failure', '#f79009'], ['deadlock', '#d92d20'], ['error', '#101828']];
  figures.push({
    file: 'fig3_multi_seat_outcomes.png',
    title: 'Fig. 3 — Outcome of every request, overlapping 3-seat requests (E2, c = 16)',
    config: {
      type: 'bar',
      data: { labels: ss.map(label), datasets: kinds.map(([k, col]) => ({ label: label(k), backgroundColor: col, data: ss.map((s) => rows.find((r) => r.strategy === s)?.[k] ?? 0) })) },
      options: { scales: { x: { stacked: true }, y: { stacked: true, title: { display: true, text: 'requests (all trials)' } } } },
    },
  });
}

// Fig 4 — low-contention latency distribution (E3) as p25–p75 box + p50/p95 markers
{
  const rows = readCsv('e3_low_contention.csv');
  const cMax = Math.max(...rows.map((r) => r.concurrency));
  const sel = ORDER.filter((s) => rows.some((r) => r.strategy === s && r.concurrency === cMax));
  const get = (s) => rows.find((r) => r.strategy === s && r.concurrency === cMax);
  figures.push({
    file: 'fig4_low_contention_latency.png',
    title: `Fig. 4 — Latency without collisions (E3, c = ${cMax}): box = p25–p75, dot = median, × = p95`,
    config: {
      type: 'bar',
      data: {
        labels: sel.map(label),
        datasets: [
          { type: 'bar', label: 'p25–p75', backgroundColor: sel.map((s) => COLORS[s] + '88'), borderColor: sel.map((s) => COLORS[s]), borderWidth: 1, data: sel.map((s) => [get(s).latency_p25_ms, get(s).latency_p75_ms]) },
          { type: 'scatter', label: 'median', backgroundColor: '#101828', pointRadius: 5, data: sel.map((s, i) => ({ x: label(s), y: get(s).latency_p50_ms })) },
          { type: 'scatter', label: 'p95', pointStyle: 'crossRot', borderColor: '#d92d20', pointRadius: 7, borderWidth: 2, data: sel.map((s) => ({ x: label(s), y: get(s).latency_p95_ms })) },
        ],
      },
      options: { scales: { y: { type: 'logarithmic', title: { display: true, text: 'latency (ms)' } } } },
    },
  });
  // Fig 5 — throughput with CI
  figures.push({
    file: 'fig5_throughput.png',
    title: 'Fig. 5 — Throughput (successful holds / s) with 95% bootstrap CI (E3)',
    config: {
      type: 'bar',
      data: {
        labels: sel.map(label),
        datasets: [...new Set(rows.map((r) => r.concurrency))].sort((a, b) => a - b).map((c, i) => ({
          label: `c = ${c}`, backgroundColor: ['#98a2b3', '#F84464'][i % 2],
          data: sel.map((s) => rows.find((r) => r.strategy === s && r.concurrency === c)?.throughput_tps_mean ?? null),
          errorBars: sel.map((s) => { const r = rows.find((x) => x.strategy === s && x.concurrency === c); return r ? [r.throughput_ci_low, r.throughput_ci_high] : null; }),
        })),
      },
      options: { scales: { y: { title: { display: true, text: 'holds per second' }, beginAtZero: true } } },
    },
  });
}

// Fig 6 — live latency CDF (E4a) with the 200 ms target
{
  const samples = readCsv('e4a_live_samples.csv').filter((r) => r.status === 200 && r.first !== 'true' && r.first !== true);
  if (samples.length) {
    const eps = ['static', 'health', 'movies', 'showtimes', 'seats'].filter((e) => samples.some((s) => s.endpoint === e));
    const col = { static: '#98a2b3', health: '#12b76a', movies: '#2e90fa', showtimes: '#7a5af8', seats: '#F84464' };
    figures.push({
      file: 'fig6_live_latency_cdf.png',
      title: 'Fig. 6 — Live end-to-end latency CDF from the client (E4a); dashed line = PRD target 200 ms',
      config: {
        type: 'scatter',
        data: {
          datasets: [
            ...eps.map((e) => {
              const xs = samples.filter((s) => s.endpoint === e).map((s) => s.latency_ms).sort((a, b) => a - b);
              return { label: e === 'static' ? 'static file (network baseline)' : `/${e}`, showLine: true, pointRadius: 0, borderWidth: 2, borderColor: col[e], data: xs.map((x, i) => ({ x, y: (i + 1) / xs.length })) };
            }),
            { label: '200 ms target', showLine: true, pointRadius: 0, borderDash: [6, 4], borderColor: '#101828', data: [{ x: 200, y: 0 }, { x: 200, y: 1 }] },
          ],
        },
        options: { scales: { x: { type: 'logarithmic', title: { display: true, text: 'latency (ms, log)' } }, y: { min: 0, max: 1, title: { display: true, text: 'fraction of requests ≤ x' } } } },
      },
    });
  }
}

// Fig 7 — platform comparison (E5 vs E1, naive)
{
  const lite = readCsv('e5_platform_pglite.csv');
  const neon = readCsv('e1_hot_seat.csv');
  if (lite.length) {
    const c = lite[0].concurrency;
    const ss = ['naive', 'conditional_update', 'serializable'];
    figures.push({
      file: 'fig7_platform.png',
      title: `Fig. 7 — Same code, different platform: share of trials with a double booking (c = ${c})`,
      config: {
        type: 'bar',
        data: {
          labels: ss.map(label),
          datasets: [
            { label: 'Neon Postgres (networked, concurrent)', backgroundColor: '#F84464', data: ss.map((s) => neon.find((r) => r.strategy === s && r.concurrency === c)?.p_double_booking ?? 0) },
            { label: 'PGlite (embedded, serial)', backgroundColor: '#2e90fa', data: ss.map((s) => lite.find((r) => r.strategy === s)?.p_double_booking ?? 0) },
          ],
        },
        options: { scales: { y: { min: 0, max: 1, title: { display: true, text: 'P(trial has ≥1 double booking)' } } } },
      },
    });
  }
}

// ---- E6–E12 (extended study) ---------------------------------------------------------------
const SITE = { CineBook: '#D81E43', BookMyShow: '#475467', District: '#98a2b3' };
{
  const rows = readCsv('e6_web_perf.csv');
  const labels = rows.map((r) => `${r.site} ${r.page}`);
  figures.push({
    file: 'fig9_web_lcp.png',
    title: 'Fig. 9 — Largest Contentful Paint, mean ± SD of 5 cold loads (E6)',
    config: {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'LCP (ms)', backgroundColor: rows.map((r) => SITE[r.site]), data: rows.map((r) => r.lcp_mean_ms),
          errorBars: rows.map((r) => [Math.max(0, r.lcp_mean_ms - r.lcp_sd_ms), r.lcp_mean_ms + r.lcp_sd_ms]),
        }],
      },
      options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, suggestedMax: 1800, title: { display: true, text: 'LCP (ms), lower is better' } } } },
    },
  });
  figures.push({
    file: 'fig10_page_weight.png',
    title: 'Fig. 10 — Page weight by resource type (E6)',
    config: {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'JavaScript', backgroundColor: '#1d2939', data: rows.map((r) => r.js_kb) },
          { label: 'Images', backgroundColor: '#98a2b3', data: rows.map((r) => r.image_kb) },
          { label: 'Other', backgroundColor: '#d0d5dd', data: rows.map((r) => Math.max(0, +(r.transfer_kb - r.js_kb - r.image_kb).toFixed(1))) },
        ],
      },
      options: { scales: { x: { stacked: true }, y: { stacked: true, title: { display: true, text: 'transferred (KB)' } } } },
    },
  });
}
{
  const rows = readCsv('e6_accessibility.csv');
  const groups = [
    ['CineBook (before)', rows.filter((r) => r.site === 'CineBook' && r.phase === 'before fixes')],
    ['CineBook (after)', rows.filter((r) => r.site === 'CineBook' && r.phase === 'after fixes')],
    ['BookMyShow home', rows.filter((r) => r.site === 'BookMyShow')],
    ['District movies', rows.filter((r) => r.site === 'District')],
  ];
  const sumOf = (g, k) => g.reduce((t, r) => t + (r[k] || 0), 0);
  figures.push({
    file: 'fig11_accessibility.png',
    title: 'Fig. 11 — WCAG 2.2 AA violations (affected elements) by impact, axe-core (E6)',
    config: {
      type: 'bar',
      data: {
        labels: groups.map((g) => g[0]),
        datasets: [['critical', '#7a271a'], ['serious', '#d92d20'], ['moderate', '#f79009'], ['minor', '#fdb022']].map(([k, c]) => ({
          label: k, backgroundColor: c, data: groups.map((g) => sumOf(g[1], k)),
        })),
      },
      options: { scales: { x: { stacked: true }, y: { stacked: true, title: { display: true, text: 'elements violating a rule' } } } },
    },
  });
}
{
  const rows = readCsv('e8_scalability.csv');
  const users = [10, 50, 100, 500];
  const line = (w, k, color, dash) => ({
    label: `${w} ${k.replace('_ms', '')}`, borderColor: color, backgroundColor: color, borderDash: dash, borderWidth: 2.5,
    data: users.map((n) => rows.find((r) => r.workload === w && r.users === n)?.[k] ?? null),
  });
  figures.push({
    file: 'fig12_scalability_latency.png',
    title: 'Fig. 12 — Latency vs concurrent users on the live deployment (E8)',
    config: {
      type: 'line',
      data: { labels: users.map(String), datasets: [line('read', 'p50_ms', '#2e90fa', [4, 3]), line('read', 'p95_ms', '#2e90fa', []), line('write', 'p50_ms', '#D81E43', [4, 3]), line('write', 'p95_ms', '#D81E43', [])] },
      options: { scales: { x: { title: { display: true, text: 'concurrent users' } }, y: { beginAtZero: true, title: { display: true, text: 'latency (ms)' } } } },
    },
  });
  figures.push({
    file: 'fig13_scalability_throughput.png',
    title: 'Fig. 13 — Throughput vs concurrent users, mean ± SD of 3 repeats (E8)',
    config: {
      type: 'bar',
      data: {
        labels: users.map(String),
        datasets: [['read', '#2e90fa'], ['write', '#D81E43']].map(([w, c]) => {
          const rs = users.map((n) => rows.find((r) => r.workload === w && r.users === n));
          return { label: `${w} (successful requests/s)`, backgroundColor: c, data: rs.map((r) => r?.throughput_mean ?? null), errorBars: rs.map((r) => (r ? [Math.max(0, r.throughput_mean - r.throughput_sd), r.throughput_mean + r.throughput_sd] : null)) };
        }),
      },
      options: { scales: { x: { title: { display: true, text: 'concurrent users' } }, y: { beginAtZero: true, suggestedMax: 700, title: { display: true, text: 'requests per second (mean ± SD)' } } } },
    },
  });
}
{
  const rows = readCsv('e10_db_optimisation.csv');
  const pairs = [
    ['seat map', 'no index (seq scan)', 'PK (showtime_id, seat_id)'],
    ['hold (2 seats)', 'no index (seq scan)', 'PK (showtime_id, seat_id)'],
    ['expiry sweep', 'no index', 'partial index (HELD only)'],
    ['my bookings', 'no index', 'composite (user_id, created_at)'],
    ['seat map + layout', 'normalised (3-table join)', 'denormalised (1 table)'],
  ];
  const get = (q, v) => rows.find((r) => r.query === q && r.variant === v)?.median_ms ?? null;
  figures.push({
    file: 'fig14_db_optimisation.png',
    title: 'Fig. 14 — Server-side execution time before and after optimisation, 1 M seat rows (E10), log scale',
    config: {
      type: 'bar',
      data: {
        labels: pairs.map((p) => p[0]),
        datasets: [
          { label: 'baseline (no index / normalised join)', backgroundColor: '#98a2b3', data: pairs.map((p) => get(p[0], p[1])) },
          { label: 'optimised (index / denormalised)', backgroundColor: '#D81E43', data: pairs.map((p) => get(p[0], p[2])) },
        ],
      },
      options: { scales: { y: { type: 'logarithmic', min: 0.01, max: 200, title: { display: true, text: 'median execution time (ms)' } } } },
    },
  });
}
{
  const rows = readCsv('e12_recsim.csv').filter((r) => r.noise === 0.5);
  const order = ['default', 'popularity', 'language_filter', 'content_based'];
  const colors = { default: '#d0d5dd', popularity: '#98a2b3', language_filter: '#475467', content_based: '#D81E43' };
  const metrics = [['hr3', 'HR@3'], ['mrr', 'MRR'], ['ndcg5', 'NDCG@5']];
  figures.push({
    file: 'fig15_recsim.png',
    title: 'Fig. 15 — Discovery quality by ranking policy, 2,000 simulated personas, 95 % CI (E12)',
    config: {
      type: 'bar',
      data: {
        labels: metrics.map((m) => m[1]),
        datasets: order.map((p) => {
          const r = rows.find((x) => x.policy === p);
          return { label: p.replace(/_/g, ' '), backgroundColor: colors[p], data: metrics.map(([k]) => r[`${k}_mean`]), errorBars: metrics.map(([k]) => [r[`${k}_ci_lo`], r[`${k}_ci_hi`]]) };
        }),
      },
      options: { scales: { y: { beginAtZero: true, max: 1, title: { display: true, text: 'score (higher is better)' } } } },
    },
  });
}

// ---- render ---------------------------------------------------------------------------------
const browser = await chromium.launch();
let errors = 0;
for (const f of figures) {
  // Fresh page per figure: globals from one chart must not leak into the next.
  // Paper style (--paper): no title in the image (the report captions it), larger type
  // so it stays legible at single-column width, serif font to match the text.
  const paper = !process.argv.includes('--titled');
  const W = paper ? 720 : 968;
  const H = paper ? 450 : 500;
  const page = await browser.newPage({ viewport: { width: W + 32, height: H + 60 }, deviceScaleFactor: 3 });
  page.on('pageerror', (e) => { errors++; console.log('  page error:', e.message); });
  // A tiny error-bar plugin (Chart.js has none built in).
  const html = `<!doctype html><html><head><script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js"></script>
  <style>body{margin:0;font-family:Segoe UI,Roboto,sans-serif;background:#fff}h3{font-size:16px;margin:12px 16px 0;color:#101828}#w{width:${W}px;height:${H}px;margin:${paper ? 8 : 4}px 16px}</style></head>
  <body>${paper ? '' : `<h3>${f.title}</h3>`}<div id="w"><canvas id="c"></canvas></div><script>
  if (${paper}) { Chart.defaults.font.family = 'Calibri, Carlito, sans-serif'; Chart.defaults.font.size = 17; Chart.defaults.color = '#111'; }
  const errorBars = { id:'errorBars', afterDatasetsDraw(chart){ const {ctx}=chart; chart.data.datasets.forEach((ds,i)=>{ if(!ds.errorBars) return; const meta=chart.getDatasetMeta(i); meta.data.forEach((bar,j)=>{ const e=ds.errorBars[j]; if(!e) return; const y=chart.scales.y; ctx.save(); ctx.strokeStyle='#101828'; ctx.lineWidth=1.5; ctx.beginPath(); ctx.moveTo(bar.x,y.getPixelForValue(e[0])); ctx.lineTo(bar.x,y.getPixelForValue(e[1])); ctx.moveTo(bar.x-5,y.getPixelForValue(e[0])); ctx.lineTo(bar.x+5,y.getPixelForValue(e[0])); ctx.moveTo(bar.x-5,y.getPixelForValue(e[1])); ctx.lineTo(bar.x+5,y.getPixelForValue(e[1])); ctx.stroke(); ctx.restore(); }); }); } };
  const cfg = ${JSON.stringify(f.config)};
  cfg.options = Object.assign({ animation:false, responsive:true, maintainAspectRatio:false, plugins:{ legend:{ position:'bottom' } } }, cfg.options);
  if (cfg.data.labels && cfg.options.scales && !cfg.options.scales.x?.type) cfg.options.scales.x = Object.assign({ type:'category' }, cfg.options.scales.x);
  new Chart(document.getElementById('c'), Object.assign(cfg, { plugins:[errorBars] }));
  </script></body></html>`;
  await page.setContent(html, { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  if (paper) await page.locator('#w').screenshot({ path: resolve(F, f.file) });
  else await page.screenshot({ path: resolve(F, f.file), fullPage: true });
  await page.close();
  console.log('wrote', f.file);
}
if (errors) process.exitCode = 1;
await browser.close();
