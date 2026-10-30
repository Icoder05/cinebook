// Analysis for E6–E12: validates the raw logs, writes plot-ready CSVs and the statistics
// quoted in the report (mean ± SD, 95 % CIs, non-parametric tests with Holm correction).
//   node experiments/harness/analyze-extended.mjs
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ensure, PROCESSED, RAW, RESULTS } from './paths.mjs';
import {
  cliffsDelta, holm, kruskalWallis, mannWhitney, mean, median, quantile, sd, spearman, tCI, wilcoxonSignedRank, wilsonCI,
} from './stats.mjs';

const RUNS = {
  web: 'main-web', webPost: 'main-web-postfix', uxPre: 'main-ux-prefix', uxMid: 'main-ux-midfix', ux: 'main-ux',
  scale: 'main-scale', rel: 'main-reliability', db: 'main-dbopt', sec: 'main-security', rec: 'main-recsim',
};
ensure(PROCESSED);
ensure(RESULTS);
const quality = [];
function load(run) {
  const p = resolve(RAW, run, 'events.jsonl');
  if (!existsSync(p)) throw new Error(`missing run ${run}`);
  const lines = readFileSync(p, 'utf8').split('\n').filter(Boolean);
  let bad = 0;
  const rows = [];
  for (const l of lines) { try { rows.push(JSON.parse(l)); } catch { bad++; } }
  const ops = rows.filter((r) => r.type === 'op');
  const trials = rows.filter((r) => r.type === 'trial');
  quality.push({ run, lines: lines.length, unparseable: bad, ops: ops.length, trials: trials.length, opErrors: ops.filter((o) => o.outcome === 'error').length });
  return { rows, ops, trials };
}
const R = Object.fromEntries(Object.entries(RUNS).map(([k, v]) => [k, load(v)]));

const r1 = (x) => (Number.isFinite(x) ? +x.toFixed(1) : null);
const r2 = (x) => (Number.isFinite(x) ? +x.toFixed(2) : null);
const r3 = (x) => (Number.isFinite(x) ? +x.toFixed(3) : null);
const r4 = (x) => (Number.isFinite(x) ? +x.toFixed(4) : null);
/** p-values: 4 decimals, scientific notation when tiny; below 1e-15 1−cdf is at double-precision limit. */
const fmtP = (p) => (!Number.isFinite(p) ? null : p < 1e-15 ? '<1e-15' : p < 1e-4 ? p.toExponential(1) : +p.toFixed(4));
const by = (xs, f) => xs.reduce((m, x) => ((m[f(x)] ??= []).push(x), m), {});
const nums = (xs, k) => xs.map((x) => x[k]).filter(Number.isFinite);
function csv(name, rows) {
  if (!rows.length) return;
  const cols = Object.keys(rows[0]);
  const esc = (v) => (v === null || v === undefined ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  writeFileSync(resolve(PROCESSED, name), [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n') + '\n');
}
const res = {};

// ---- E6: web performance + accessibility ---------------------------------------------
{
  const loads = R.web.ops.filter((o) => o.exp === 'E6' && o.outcome === 'success');
  const post = R.webPost.ops.filter((o) => o.exp === 'E6' && o.outcome === 'success');
  const rows = [];
  for (const [key, g] of Object.entries(by(loads, (o) => o.strategy))) {
    const ci = tCI(nums(g, 'lcpMs'));
    rows.push({
      site: g[0].site, page: g[0].page, n: g.length,
      ttfb_mean_ms: r1(mean(nums(g, 'ttfbMs'))), fcp_mean_ms: r1(mean(nums(g, 'fcpMs'))),
      lcp_mean_ms: r1(ci.mean), lcp_sd_ms: r1(ci.sd), lcp_ci_lo: r1(ci.lo), lcp_ci_hi: r1(ci.hi), lcp_median_ms: r1(median(nums(g, 'lcpMs'))),
      load_mean_ms: r1(mean(nums(g, 'loadMs'))), transfer_kb: r1(mean(nums(g, 'transferKB'))), transfer_sd_kb: r1(sd(nums(g, 'transferKB'))),
      js_kb: r1(mean(nums(g, 'jsKB'))), image_kb: r1(mean(nums(g, 'imageKB'))), requests: r1(mean(nums(g, 'requests'))),
      third_party_hosts: r1(mean(nums(g, 'thirdPartyHosts'))), dom_nodes: r1(mean(nums(g, 'domNodes'))), key,
    });
  }
  csv('e6_web_perf.csv', rows);
  // Home-page comparison (the only page all three platforms expose publicly).
  const homes = { CineBook: loads.filter((o) => o.strategy === 'CineBook · home'), BookMyShow: loads.filter((o) => o.site === 'BookMyShow'), District: loads.filter((o) => o.site === 'District') };
  const tests = {};
  for (const metric of ['lcpMs', 'transferKB', 'requests']) {
    const groups = Object.values(homes).map((g) => nums(g, metric));
    const kw = kruskalWallis(groups);
    const pairs = [['CineBook', 'BookMyShow'], ['CineBook', 'District'], ['BookMyShow', 'District']];
    const raw = pairs.map(([a, b]) => mannWhitney(nums(homes[a], metric), nums(homes[b], metric)).p);
    const adj = holm(raw);
    tests[metric] = { H: r3(kw.H), df: kw.df, p: r4(kw.p), pairwise: pairs.map(([a, b], i) => ({ a, b, p: r4(raw[i]), pHolm: r4(adj[i]), cliffs: r3(cliffsDelta(nums(homes[a], metric), nums(homes[b], metric)).d) })) };
  }
  const a11y = [];
  for (const [phase, run] of [['before fixes', R.web], ['after fixes', R.webPost]]) {
    for (const t of run.trials.filter((x) => x.exp === 'E6-a11y')) {
      if (phase === 'after fixes' && t.site !== 'CineBook') continue;
      a11y.push({ phase, site: t.site, page: t.page, rules: t.violationRules, nodes: t.violationNodes, critical: t.critical, serious: t.serious, moderate: t.moderate, minor: t.minor, passes: t.passes, detail: t.rules });
    }
  }
  csv('e6_accessibility.csv', a11y);
  const resp = R.web.trials.filter((t) => t.exp === 'E6-responsive').map((t) => ({ site: t.site, page: t.page, width: t.width, overflow_px: t.overflowPx }));
  csv('e6_responsive.csv', resp);
  const postPerf = Object.entries(by(post, (o) => o.strategy)).map(([k, g]) => ({ key: k, lcp_mean_ms: r1(mean(nums(g, 'lcpMs'))), transfer_kb: r1(mean(nums(g, 'transferKB'))) }));
  res.E6 = { pages: rows.length, loads: loads.length, homeTests: tests, postFixPerf: postPerf, overflowAny: resp.some((r) => r.overflow_px > 0) };
}

// ---- E7: funnel + KLM + keyboard ------------------------------------------------------
{
  const f = R.ux.trials.filter((t) => t.exp === 'E7' && !t.error);
  const rows = Object.entries(by(f, (t) => t.device)).map(([device, g]) => {
    const ci = tCI(nums(g, 'robotSec'));
    return {
      device, n: g.length, screens_mean: r2(mean(nums(g, 'screens'))), screens_min: Math.min(...nums(g, 'screens')), screens_max: Math.max(...nums(g, 'screens')),
      dialogs: r2(mean(nums(g, 'dialogs'))), clicks: r2(mean(nums(g, 'clicks'))), keystrokes: r2(mean(nums(g, 'keystrokes'))), form_fields: r2(mean(nums(g, 'formFields'))),
      robot_sec_mean: r2(ci.mean), robot_sec_sd: r2(ci.sd), robot_ci_lo: r2(ci.lo), robot_ci_hi: r2(ci.hi),
      klm_total_sec: r1(mean(nums(g, 'klmSec'))), klm_after_signin_sec: r1(mean(nums(g, 'klmAfterSignInSec'))), klm_checkout_sec: r1(mean(nums(g, 'klmCheckoutSec'))),
      stage_signin_s: r2(mean(nums(g, 'stageSignIn'))), stage_discovery_s: r2(mean(nums(g, 'stageDiscovery'))), stage_showtime_s: r2(mean(nums(g, 'stageShowtime'))),
      stage_seats_s: r2(mean(nums(g, 'stageSeats'))), stage_checkout_s: r2(mean(nums(g, 'stageCheckout'))),
      fee_breakdown_before_pay: g.every((t) => t.feeBreakdownBeforePay), seat_retries: nums(g, 'seatRetries').reduce((a, b) => a + b, 0),
    };
  });
  csv('e7_funnel.csv', rows);
  const kb = [];
  for (const [phase, run] of [['1 before fixes', R.uxPre], ['2 toast trap fixed', R.uxMid], ['3 all fixes', R.ux]]) {
    for (const t of run.trials.filter((x) => x.exp === 'E7-keyboard')) kb.push({ phase, trial: t.trial, completed: t.completed, tabs: t.tabs, tabs_seat_map: t.tabsSeatMap ?? null, stops: t.stops, invisible_focus: t.invisibleFocus, failed_at: t.failedAt ?? '' });
  }
  csv('e7_keyboard.csv', kb);
  const mt = R.ux.trials.filter((t) => t.exp === 'E7' && !t.error);
  const dm = mannWhitney(nums(mt.filter((t) => t.device === 'desktop'), 'robotSec'), nums(mt.filter((t) => t.device === 'mobile'), 'robotSec'));
  res.E7 = { devices: rows, desktopVsMobileRobotP: r4(dm.p), keyboard: Object.entries(by(kb, (k) => k.phase)).map(([phase, g]) => ({ phase, completed: g.filter((k) => k.completed).length, n: g.length, tabsMean: r1(mean(g.filter((k) => k.completed).map((k) => k.tabs))) })) };
}

// ---- E8: scalability -----------------------------------------------------------------
{
  const ops = R.scale.ops.filter((o) => o.exp === 'E8');
  const trials = R.scale.trials.filter((t) => t.exp === 'E8');
  const rows = [];
  const repRows = [];
  for (const w of ['read', 'write']) {
    for (const n of [10, 50, 100, 500]) {
      const g = ops.filter((o) => o.strategy === w && o.c === n);
      const lat = nums(g, 'latencyMs');
      const tr = trials.filter((t) => t.strategy === w && t.c === n);
      const tp = tCI(nums(tr, 'throughput'));
      const errs = g.filter((o) => o.outcome !== 'success').length;
      const wil = wilsonCI(errs, g.length);
      const p95s = tr.map((t) => quantile(nums(g.filter((o) => o.trial === t.trial), 'latencyMs'), 0.95));
      const p95ci = tCI(p95s);
      rows.push({
        workload: w, users: n, repeats: tr.length, requests: g.length, errors: errs, error_rate: r4(errs / g.length), error_ci_hi: r4(wil[1]),
        p50_ms: r1(quantile(lat, 0.5)), p95_ms: r1(quantile(lat, 0.95)), p99_ms: r1(quantile(lat, 0.99)), mean_ms: r1(mean(lat)), sd_ms: r1(sd(lat)),
        p95_rep_mean: r1(p95ci.mean), p95_rep_sd: r1(p95ci.sd), p95_ci_lo: r1(Math.max(0, p95ci.lo)), p95_ci_hi: r1(p95ci.hi),
        throughput_mean: r1(tp.mean), throughput_sd: r1(tp.sd), throughput_ci_lo: r1(Math.max(0, tp.lo)), throughput_ci_hi: r1(tp.hi),
        makespan_mean_ms: r1(mean(nums(tr, 'makespanMs'))),
      });
      for (const t of tr) repRows.push({ workload: w, users: n, rep: t.trial, p95_ms: r1(quantile(nums(g.filter((o) => o.trial === t.trial), 'latencyMs'), 0.95)), throughput: t.throughput });
    }
  }
  csv('e8_scalability.csv', rows);
  csv('e8_repeats.csv', repRows);
  const tests = {};
  for (const w of ['read', 'write']) {
    const rr = repRows.filter((r) => r.workload === w);
    const sp = spearman(rr.map((r) => r.users), rr.map((r) => r.p95_ms));
    const kw = kruskalWallis([10, 50, 100, 500].map((n) => nums(ops.filter((o) => o.strategy === w && o.c === n), 'latencyMs')));
    tests[w] = { spearmanUsersVsP95: { rho: r3(sp.rho), p: fmtP(sp.p), n: sp.n }, kruskalLatencyByUsers: { H: r1(kw.H), df: kw.df, p: fmtP(kw.p) } };
  }
  const inv = R.scale.trials.find((t) => t.exp === 'E9-invariants');
  res.E8 = { totalRequests: ops.length, totalErrors: ops.filter((o) => o.outcome !== 'success').length, errorCI: wilsonCI(ops.filter((o) => o.outcome !== 'success').length, ops.length).map(r4), tests, invariants: inv };
}

// ---- E9: reliability -----------------------------------------------------------------
{
  const t = R.rel.trials.filter((x) => x.exp === 'E9');
  const rows = Object.entries(by(t, (x) => x.strategy)).map(([scenario, g]) => {
    const pass = g.filter((x) => x.pass).length;
    const ci = wilsonCI(pass, g.length);
    const lat = tCI(nums(g, 'latencyMs'));
    const rec = tCI(nums(g, 'recoveryMs'));
    return {
      scenario, n: g.length, passed: pass, pass_ci_lo: r3(ci[0]), pass_ci_hi: r3(ci[1]),
      charges_total: g.reduce((s, x) => s + (x.charges ?? 0), 0), refunds_total: g.reduce((s, x) => s + (x.refunds ?? 0), 0),
      latency_mean_ms: r1(lat.mean), latency_sd_ms: r1(lat.sd), recovery_mean_ms: r1(rec.mean), recovery_sd_ms: r1(rec.sd), retries_mean: r2(mean(nums(g, 'retries'))),
      final_states: [...new Set(g.map((x) => `${x.bookingStatus ?? '-'}/${x.seatAfter ?? '-'}`))].join('; '),
    };
  });
  csv('e9_reliability.csv', rows);
  const inv = R.rel.trials.find((x) => x.exp === 'E9-invariants');
  const total = t.length;
  const passed = t.filter((x) => x.pass).length;
  res.E9 = { trials: total, passed, passCI: wilsonCI(passed, total).map(r4), ruleOfThreeFailureUpper: r4(3 / total), invariants: inv };
}

// ---- E10: database optimisation ------------------------------------------------------
{
  const ops = R.db.ops.filter((o) => o.exp === 'E10');
  const rows = [];
  const tests = [];
  for (const [query, g] of Object.entries(by(ops, (o) => o.query))) {
    const variants = [...new Set(g.map((o) => o.variant))];
    const base = nums(g.filter((o) => o.variant === variants[0]), 'latencyMs');
    for (const v of variants) {
      const x = nums(g.filter((o) => o.variant === v), 'latencyMs');
      const ci = tCI(x);
      rows.push({
        query, variant: v, n: x.length, mean_ms: r3(ci.mean), sd_ms: r3(ci.sd), ci_lo: r3(ci.lo), ci_hi: r3(ci.hi), median_ms: r3(median(x)), p95_ms: r3(quantile(x, 0.95)),
        speedup_vs_first: v === variants[0] ? 1 : r3(median(base) / median(x)), plan: g.find((o) => o.variant === v).plan ?? '',
      });
      if (v !== variants[0]) {
        const mw = mannWhitney(base, x);
        tests.push({ query, baseline: variants[0], variant: v, p: mw.p, cliffs: r3(cliffsDelta(base, x).d) });
      }
    }
  }
  const adj = holm(tests.map((t) => t.p));
  tests.forEach((t, i) => { t.pHolm = fmtP(adj[i]); t.p = fmtP(t.p); });
  csv('e10_db_optimisation.csv', rows);
  csv('e10_tests.csv', tests);
  const sizes = R.db.trials.filter((t) => t.exp === 'E10-size').map((t) => ({ object: t.strategy, size_mb: t.sizeMB }));
  csv('e10_sizes.csv', sizes);
  const dataset = R.db.rows.find((r) => r.type === 'dataset');
  res.E10 = { dataset, tests, sizes };
}

// ---- E11: security -------------------------------------------------------------------
{
  const t = R.sec.trials.filter((x) => x.exp === 'E11');
  csv('e11_security.csv', t.map((x) => ({ owasp: x.strategy, id: x.id, test: x.description, expected: x.expected, observed: x.actual, pass: x.pass, note: x.note ?? '' })));
  const cats = Object.entries(by(t, (x) => x.strategy)).map(([c, g]) => ({ category: c, checks: g.length, passed: g.filter((x) => x.pass).length }));
  csv('e11_summary.csv', cats);
  res.E11 = { checks: t.length, passed: t.filter((x) => x.pass).length, categories: cats };
}

// ---- E12: recommender simulation -----------------------------------------------------
{
  const t = R.rec.trials.filter((x) => x.exp === 'E12');
  const rows = [];
  const tests = [];
  for (const [noise, g] of Object.entries(by(t, (x) => x.noise))) {
    const pol = by(g, (x) => x.strategy);
    for (const [p, xs] of Object.entries(pol)) {
      const row = { noise: +noise, policy: p, n: xs.length };
      for (const m of ['hr3', 'mrr', 'ndcg5', 'rowsScrolled']) {
        const ci = tCI(nums(xs, m));
        Object.assign(row, { [`${m}_mean`]: r3(ci.mean), [`${m}_sd`]: r3(ci.sd), [`${m}_ci_lo`]: r3(ci.lo), [`${m}_ci_hi`]: r3(ci.hi) });
      }
      rows.push(row);
    }
    // Paired by persona: content-based vs each baseline on reciprocal rank.
    const cb = new Map(pol.content_based.map((x) => [x.trial, x.mrr]));
    for (const base of ['default', 'language_filter', 'popularity']) {
      const pairs = pol[base].filter((x) => cb.has(x.trial));
      const w = wilcoxonSignedRank(pairs.map((x) => cb.get(x.trial)), pairs.map((x) => x.mrr));
      tests.push({ noise: +noise, comparison: `content_based vs ${base}`, n: w.n, z: r2(w.z), p: w.p, r: r3(w.r), mrr_gain: r3(mean(pairs.map((x) => cb.get(x.trial) - x.mrr))) });
    }
  }
  const adj = holm(tests.map((x) => x.p));
  tests.forEach((x, i) => { x.pHolm = fmtP(adj[i]); x.p = fmtP(x.p); });
  csv('e12_recsim.csv', rows);
  csv('e12_tests.csv', tests);
  res.E12 = { personasPerNoise: E12n(t), tests };
}
function E12n(t) { return new Set(t.filter((x) => x.strategy === 'default' && x.noise === 0.5).map((x) => x.trial)).size; }

csv('data_quality_extended.csv', quality);
res.dataQuality = quality;
writeFileSync(resolve(RESULTS, 'results-extended.json'), JSON.stringify(res, null, 2));
console.log(JSON.stringify(res, (k, v) => (k === 'invariants' || k === 'sizes' ? undefined : v), 1).slice(0, 6000));
