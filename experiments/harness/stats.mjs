// Statistics used by the analysis. Non-parametric by default: latencies are skewed and
// heavy-tailed, so we report medians/percentiles with bootstrap CIs and compare groups
// with rank tests (Mann–Whitney U, Kruskal–Wallis) plus Cliff's delta as effect size.
// Run `node experiments/harness/stats.mjs` to execute the self-test against reference values.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { jStat } = require('jstat');

// --- seeded RNG (reproducible bootstrap / inputs) ---------------------------------
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(arr, rnd) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// --- descriptive ---------------------------------------------------------------------
export const sum = (xs) => xs.reduce((a, b) => a + b, 0);
export const mean = (xs) => (xs.length ? sum(xs) / xs.length : NaN);
export function sd(xs) {
  if (xs.length < 2) return NaN;
  const m = mean(xs);
  return Math.sqrt(sum(xs.map((x) => (x - m) ** 2)) / (xs.length - 1));
}
/** Quantile with linear interpolation (Hyndman & Fan type 7, the R/NumPy default). */
export function quantile(xs, q) {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const h = (s.length - 1) * q;
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  return s[lo] + (h - lo) * (s[hi] - s[lo]);
}
export const median = (xs) => quantile(xs, 0.5);

/** Percentile bootstrap CI for any statistic. */
export function bootstrapCI(xs, stat, { B = 2000, alpha = 0.05, seed = 42 } = {}) {
  if (xs.length < 2) return [NaN, NaN];
  const rnd = mulberry32(seed);
  const n = xs.length;
  const reps = new Array(B);
  const buf = new Array(n);
  for (let b = 0; b < B; b++) {
    for (let i = 0; i < n; i++) buf[i] = xs[Math.floor(rnd() * n)];
    reps[b] = stat(buf);
  }
  return [quantile(reps, alpha / 2), quantile(reps, 1 - alpha / 2)];
}

// --- proportions -----------------------------------------------------------------------
/** Wilson score interval (Wilson 1927; recommended by Brown, Cai & DasGupta 2001). */
export function wilsonCI(k, n, alpha = 0.05) {
  if (n === 0) return [NaN, NaN];
  const z = jStat.normal.inv(1 - alpha / 2, 0, 1);
  const p = k / n;
  const denom = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}
/** "Rule of three": with 0 events in n trials, the 95% upper bound on the rate is ≈ 3/n. */
export const ruleOfThree = (n) => 3 / n;

/** Two-sided Fisher exact test for a 2×2 table [[a,b],[c,d]]. */
export function fisherExact(a, b, c, d) {
  const n = a + b + c + d;
  const row1 = a + b;
  const col1 = a + c;
  const lf = (x) => jStat.gammaln(x + 1);
  const logP = (x) =>
    lf(row1) + lf(n - row1) + lf(col1) + lf(n - col1) - lf(n) - lf(x) - lf(row1 - x) - lf(col1 - x) - lf(n - row1 - col1 + x);
  const pObs = Math.exp(logP(a));
  let p = 0;
  const lo = Math.max(0, row1 + col1 - n);
  const hi = Math.min(row1, col1);
  for (let x = lo; x <= hi; x++) {
    const px = Math.exp(logP(x));
    if (px <= pObs * (1 + 1e-7)) p += px;
  }
  return Math.min(1, p);
}

// --- rank tests ------------------------------------------------------------------------
function rank(values) {
  const idx = values.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]);
  const ranks = new Array(values.length);
  const ties = [];
  for (let i = 0; i < idx.length; ) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[idx[k][1]] = r;
    if (j > i) ties.push(j - i + 1);
    i = j + 1;
  }
  return { ranks, ties };
}

/** Mann–Whitney U (two-sided, normal approximation with tie and continuity correction). */
export function mannWhitney(x, y) {
  const n1 = x.length;
  const n2 = y.length;
  const { ranks, ties } = rank([...x, ...y]);
  const r1 = sum(ranks.slice(0, n1));
  const u1 = r1 - (n1 * (n1 + 1)) / 2;
  const u = Math.min(u1, n1 * n2 - u1);
  const n = n1 + n2;
  const tieTerm = sum(ties.map((t) => t ** 3 - t)) / (n * (n - 1));
  const sigma = Math.sqrt(((n1 * n2) / 12) * (n + 1 - tieTerm));
  const z = sigma === 0 ? 0 : (Math.abs(u1 - (n1 * n2) / 2) - 0.5) / sigma;
  const p = sigma === 0 ? 1 : Math.min(1, 2 * (1 - jStat.normal.cdf(Math.max(z, 0), 0, 1)));
  return { U: u1, z: (u1 - (n1 * n2) / 2) / (sigma || 1), p };
}

/** Cliff's delta: P(X>Y) − P(X<Y). Magnitudes per Romano et al. (2006). */
export function cliffsDelta(x, y) {
  // O((n+m) log) via sorting y and binary search
  const ys = [...y].sort((a, b) => a - b);
  const lower = (v) => {
    let lo = 0, hi = ys.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (ys[m] < v) lo = m + 1; else hi = m; }
    return lo;
  };
  const upper = (v) => {
    let lo = 0, hi = ys.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (ys[m] <= v) lo = m + 1; else hi = m; }
    return lo;
  };
  let more = 0;
  let less = 0;
  for (const v of x) {
    less += ys.length - upper(v); // y > v
    more += lower(v); // y < v
  }
  const d = (more - less) / (x.length * y.length);
  const a = Math.abs(d);
  const magnitude = a < 0.147 ? 'negligible' : a < 0.33 ? 'small' : a < 0.474 ? 'medium' : 'large';
  return { d, magnitude };
}

/** Kruskal–Wallis H test (tie-corrected), p from χ²(k−1). */
export function kruskalWallis(groups) {
  const all = groups.flat();
  const n = all.length;
  const { ranks, ties } = rank(all);
  let offset = 0;
  let h = 0;
  for (const g of groups) {
    const r = sum(ranks.slice(offset, offset + g.length));
    h += (r * r) / g.length;
    offset += g.length;
  }
  h = (12 / (n * (n + 1))) * h - 3 * (n + 1);
  const c = 1 - sum(ties.map((t) => t ** 3 - t)) / (n ** 3 - n);
  h /= c || 1;
  const df = groups.length - 1;
  return { H: h, df, p: 1 - jStat.chisquare.cdf(h, df) };
}

/** Mean with a Student-t 95 % confidence interval (for small numbers of repeats). */
export function tCI(xs, alpha = 0.05) {
  const n = xs.length;
  const m = mean(xs);
  if (n < 2) return { mean: m, sd: NaN, lo: NaN, hi: NaN, n };
  const s = sd(xs);
  const h = jStat.studentt.inv(1 - alpha / 2, n - 1) * (s / Math.sqrt(n));
  return { mean: m, sd: s, lo: m - h, hi: m + h, n };
}

/**
 * Wilcoxon signed-rank test for paired samples (two-sided). Zero differences are dropped
 * (Wilcoxon's method); normal approximation with tie correction, no continuity correction
 * — matches scipy.stats.wilcoxon(x, y, method='approx'). r = |z|/√n is the effect size.
 */
export function wilcoxonSignedRank(x, y) {
  const d = x.map((v, i) => v - y[i]).filter((v) => v !== 0);
  const n = d.length;
  if (!n) return { W: 0, z: 0, p: 1, n: 0, r: 0 };
  const { ranks, ties } = rank(d.map(Math.abs));
  const wPlus = sum(ranks.filter((_, i) => d[i] > 0));
  const mu = (n * (n + 1)) / 4;
  const sigma = Math.sqrt((n * (n + 1) * (2 * n + 1)) / 24 - sum(ties.map((t) => t ** 3 - t)) / 48);
  const z = sigma ? (wPlus - mu) / sigma : 0;
  const p = Math.min(1, 2 * (1 - jStat.normal.cdf(Math.abs(z), 0, 1)));
  return { W: Math.min(wPlus, (n * (n + 1)) / 2 - wPlus), z, p, n, r: Math.abs(z) / Math.sqrt(n) };
}

/** Spearman rank correlation with a t-approximation p-value. */
export function spearman(x, y) {
  const rx = rank(x).ranks;
  const ry = rank(y).ranks;
  const mx = mean(rx);
  const my = mean(ry);
  const cov = sum(rx.map((v, i) => (v - mx) * (ry[i] - my)));
  const rho = cov / Math.sqrt(sum(rx.map((v) => (v - mx) ** 2)) * sum(ry.map((v) => (v - my) ** 2)));
  const n = x.length;
  const t = rho * Math.sqrt((n - 2) / Math.max(1e-12, 1 - rho * rho));
  return { rho, p: 2 * (1 - jStat.studentt.cdf(Math.abs(t), n - 2)), n };
}

/** Holm–Bonferroni adjusted p-values (same order as input). */
export function holm(ps) {
  const order = ps.map((p, i) => [p, i]).sort((a, b) => a[0] - b[0]);
  const adj = new Array(ps.length);
  let running = 0;
  order.forEach(([p, i], rankIdx) => {
    running = Math.max(running, Math.min(1, (ps.length - rankIdx) * p));
    adj[i] = running;
  });
  return adj;
}

// --- self-test -----------------------------------------------------------------------
if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('stats.mjs')) {
  const close = (a, b, tol = 1e-3) => Math.abs(a - b) <= tol;
  const checks = [
    // Wilson: 0/30 → [0, 0.1135]; 5/10 → [0.2366, 0.7634] (standard tables)
    ['wilson 0/30 upper', close(wilsonCI(0, 30)[1], 0.1135)],
    ['wilson 5/10', close(wilsonCI(5, 10)[0], 0.2366) && close(wilsonCI(5, 10)[1], 0.7634)],
    // Fisher's "lady tasting tea": [[3,1],[1,3]] two-sided p = 0.4857
    ['fisher tea', close(fisherExact(3, 1, 1, 3), 0.4857)],
    ['fisher [[10,0],[0,10]]', close(fisherExact(10, 0, 0, 10), 1.0825e-5, 1e-7)],
    // quantile type 7: R quantile(1:10, .95) = 9.55
    ['quantile type7', close(quantile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.95), 9.55)],
    // Mann–Whitney: scipy.stats.mannwhitneyu([1,2,3,4,5],[6,7,8,9,10], method='asymptotic') p ≈ 0.01219
    ['mann-whitney separated', close(mannWhitney([1, 2, 3, 4, 5], [6, 7, 8, 9, 10]).p, 0.01219, 2e-4)],
    ['mann-whitney identical', mannWhitney([1, 2, 3], [1, 2, 3]).p > 0.9],
    ['cliff separated = -1', cliffsDelta([1, 2, 3], [4, 5, 6]).d === -1],
    ['cliff half', close(cliffsDelta([1, 3], [2]).d, 0)],
    // Kruskal–Wallis: scipy.stats.kruskal([1,2,3],[4,5,6],[7,8,9]) → H=7.2, p=0.02732
    ['kruskal H', close(kruskalWallis([[1, 2, 3], [4, 5, 6], [7, 8, 9]]).H, 7.2)],
    ['kruskal p', close(kruskalWallis([[1, 2, 3], [4, 5, 6], [7, 8, 9]]).p, 0.02732, 2e-4)],
    // scipy.stats.wilcoxon(x, y, method='approx', correction=False) → p = 0.038152
    ['wilcoxon signed-rank', close(wilcoxonSignedRank([1.83, 0.5, 1.62, 2.48, 1.68, 1.88, 1.55, 3.06, 1.3], [0.878, 0.647, 0.598, 2.05, 1.06, 1.29, 1.06, 3.14, 1.29]).p, 0.038152, 1e-5)],
    // scipy.stats.t.interval(0.95, 2, loc=12, scale=sem([10,12,14])) → (7.0317, 16.9683)
    ['t interval', close(tCI([10, 12, 14]).lo, 7.0317)],
    // scipy.stats.spearmanr([1..5],[5,6,7,8,7]) → rho 0.82078, p 0.08859
    ['spearman', close(spearman([1, 2, 3, 4, 5], [5, 6, 7, 8, 7]).rho, 0.82078) && close(spearman([1, 2, 3, 4, 5], [5, 6, 7, 8, 7]).p, 0.08859)],
    ['holm', JSON.stringify(holm([0.01, 0.04, 0.03]).map((v) => +v.toFixed(3))) === '[0.03,0.06,0.06]'],
  ];
  let failed = 0;
  for (const [name, ok] of checks) {
    if (!ok) failed++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  }
  if (failed) process.exit(1);
}
