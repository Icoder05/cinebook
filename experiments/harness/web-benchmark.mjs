// E6: public-page benchmark — CineBook vs BookMyShow vs District.
//   node experiments/harness/web-benchmark.mjs [--run name] [--loads 5] [--site CineBook]
// Ethics: only public pages that robots.txt allows; ordinary page loads spaced 4 s apart;
// no login, no seat holds, no checkout, and no attempt to bypass bot protection.
// Per page: N cold-cache loads (TTFB, FCP, LCP, DCL, load, bytes, requests, JS, third parties),
// one axe-core WCAG 2.2 AA audit, and a horizontal-overflow check at 360/768/1440 px.
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import { createLogger } from './log.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('@playwright/test');
const { AxeBuilder } = require('@axe-core/playwright');

const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const RUN_ID = opt('run', 'web-benchmark');
const LOADS = Number(opt('loads', 5));
const SITE = opt('site', null); // e.g. --site CineBook to re-audit only our own pages
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const CB = 'https://cinebook-eight-chi.vercel.app';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = createLogger(RUN_ID);

const browser = await chromium.launch({ args: ['--disable-blink-features=AutomationControlled'] });
const baseCtx = { userAgent: UA, viewport: { width: 1366, height: 860 }, locale: 'en-IN' };

// CineBook sits behind Vercel's checkpoint: pass it once and reuse only the cookie (not the cache).
const warm = await browser.newContext(baseCtx);
const wp = await warm.newPage();
await wp.goto(CB);
await wp.waitForLoadState('networkidle');
const api = async (p) => (await warm.request.get(`${CB}/api/v1${p}`)).json();
const city = (await api('/cities')).cities[0];
const movie = (await api(`/movies?status=now_showing&city=${city.id}`)).movies[0];
const st = await api(`/movies/${movie.id}/showtimes?city=${city.id}`);
const showId = st.theatres[0].showtimes[0].id;
const cbState = await warm.storageState();
await warm.close();

const ALL_PAGES = [
  { site: 'CineBook', page: 'home', url: `${CB}/`, state: cbState },
  { site: 'CineBook', page: 'movie', url: `${CB}/movies/${movie.id}`, state: cbState },
  { site: 'CineBook', page: 'seat map', url: `${CB}/showtimes/${showId}/seats`, state: cbState },
  { site: 'BookMyShow', page: 'home', url: 'https://in.bookmyshow.com/explore/home/bengaluru' },
  { site: 'District', page: 'movies home', url: 'https://www.district.in/movies/' },
];
const PAGES = SITE ? ALL_PAGES.filter((p) => p.site === SITE) : ALL_PAGES;

const manifest = {
  runId: RUN_ID, startedAt: new Date().toISOString(), loadsPerPage: LOADS, pages: PAGES.map(({ state, ...p }) => p),
  method: 'Chromium (Playwright), desktop 1366x860, cold HTTP cache per load, no CPU/network throttling; client in India',
};
log.manifest(manifest);
log.event({ type: 'run_start', runId: RUN_ID, totalCells: PAGES.length, manifest });

const collectVitals = () =>
  new Promise((resolve) => {
    const nav = performance.getEntriesByType('navigation')[0];
    const fcp = performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null;
    let lcp = null;
    try {
      new PerformanceObserver((list) => {
        const e = list.getEntries();
        if (e.length) lcp = e[e.length - 1].startTime;
      }).observe({ type: 'largest-contentful-paint', buffered: true });
    } catch { /* unsupported */ }
    setTimeout(() => resolve({
      ttfb: nav ? nav.responseStart - nav.startTime : null,
      dcl: nav ? nav.domContentLoadedEventEnd - nav.startTime : null,
      load: nav ? nav.loadEventEnd - nav.startTime : null,
      fcp, lcp,
      domNodes: document.getElementsByTagName('*').length,
    }), 300);
  });

let cell = 0;
for (const pg of PAGES) {
  cell++;
  log.event({ type: 'cell_start', exp: 'E6', strategy: `${pg.site} · ${pg.page}`, c: 1 });
  const host = new URL(pg.url).hostname.split('.').slice(-2).join('.');

  for (let i = 0; i < LOADS; i++) {
    const ctx = await browser.newContext({ ...baseCtx, storageState: pg.state });
    const page = await ctx.newPage();
    const net = { requests: 0, bytes: 0, js: 0, img: 0, hosts: new Set() };
    page.on('requestfinished', async (req) => {
      try {
        const s = await req.sizes();
        const b = s.responseBodySize + s.responseHeadersSize;
        net.requests++;
        net.bytes += b;
        if (req.resourceType() === 'script') net.js += b;
        if (req.resourceType() === 'image') net.img += b;
        net.hosts.add(new URL(req.url()).hostname);
      } catch { /* request detached */ }
    });
    const t0 = performance.now();
    let status = null;
    let error = null;
    try {
      const r = await page.goto(pg.url, { waitUntil: 'load', timeout: 60_000 });
      status = r?.status() ?? null;
      await page.waitForTimeout(4000); // let LCP settle and late requests finish
    } catch (e) {
      error = String(e.message).slice(0, 160);
    }
    const wall = performance.now() - t0;
    const v = error ? {} : await page.evaluate(collectVitals).catch(() => ({}));
    const title = await page.title().catch(() => '');
    const thirdParty = [...net.hosts].filter((h) => !h.endsWith(host)).length;
    log.op({
      exp: 'E6', strategy: `${pg.site} · ${pg.page}`, site: pg.site, page: pg.page, c: 1, trial: i, status, error, title,
      ttfbMs: v.ttfb ?? null, fcpMs: v.fcp ?? null, lcpMs: v.lcp ?? null, dclMs: v.dcl ?? null, loadMs: v.load ?? null,
      domNodes: v.domNodes ?? null, requests: net.requests, transferKB: +(net.bytes / 1024).toFixed(1),
      jsKB: +(net.js / 1024).toFixed(1), imageKB: +(net.img / 1024).toFixed(1), hosts: net.hosts.size, thirdPartyHosts: thirdParty,
      latencyMs: +wall.toFixed(1), outcome: error || (status && status >= 400) ? 'error' : 'success',
    });
    console.log(`${pg.site} ${pg.page} load ${i + 1}: status ${status} LCP ${v.lcp?.toFixed?.(0)} ms, ${(net.bytes / 1024).toFixed(0)} KB, ${net.requests} req`);
    await ctx.close();
    await sleep(4000);
  }

  // Accessibility audit (WCAG 2.0/2.1/2.2 A + AA rules).
  {
    const ctx = await browser.newContext({ ...baseCtx, storageState: pg.state });
    const page = await ctx.newPage();
    await page.goto(pg.url, { waitUntil: 'load', timeout: 60_000 }).catch(() => {});
    await page.waitForTimeout(4000);
    try {
      const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
      const byImpact = { critical: 0, serious: 0, moderate: 0, minor: 0 };
      for (const v of res.violations) byImpact[v.impact ?? 'minor'] += v.nodes.length;
      log.trial({
        exp: 'E6-a11y', strategy: `${pg.site} · ${pg.page}`, site: pg.site, page: pg.page, trial: 0,
        violationRules: res.violations.length, violationNodes: res.violations.reduce((n, v) => n + v.nodes.length, 0),
        ...byImpact, passes: res.passes.length, rules: res.violations.map((v) => `${v.id}(${v.nodes.length})`).join(' '),
      });
      console.log(`${pg.site} ${pg.page} axe: ${res.violations.length} rules, ${res.violations.map((v) => v.id).join(', ')}`);
    } catch (e) {
      log.trial({ exp: 'E6-a11y', strategy: `${pg.site} · ${pg.page}`, site: pg.site, page: pg.page, trial: 0, error: String(e.message).slice(0, 160) });
    }
    // Responsive: horizontal page overflow at phone / tablet / desktop widths.
    for (const width of [360, 768, 1440]) {
      await page.setViewportSize({ width, height: 860 });
      await page.waitForTimeout(800);
      const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth })).catch(() => ({ sw: 0, cw: 0 }));
      log.trial({ exp: 'E6-responsive', strategy: `${pg.site} · ${pg.page}`, site: pg.site, page: pg.page, trial: width, width, scrollWidth: o.sw, clientWidth: o.cw, overflowPx: Math.max(0, o.sw - o.cw) });
    }
    await ctx.close();
    await sleep(4000);
  }
  log.event({ type: 'progress', done: cell, total: PAGES.length });
}

log.event({ type: 'run_end', finishedAt: new Date().toISOString() });
manifest.finishedAt = new Date().toISOString();
log.manifest(manifest);
await log.close();
await browser.close();
