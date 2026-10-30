// Analysis: validates and cleans the raw logs, then writes plot-ready CSVs and the
// hypothesis tests used in the report.
//   node experiments/harness/analyze.mjs --neon main-neon --pglite main-pglite --live <live-run>
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG, ensure, LOGS, PROCESSED, RAW, RESULTS, ROOT } from './paths.mjs';
import {
  bootstrapCI, cliffsDelta, fisherExact, holm, kruskalWallis, mannWhitney, mean, median, quantile, ruleOfThree, wilsonCI,
} from './stats.mjs';

const root = ROOT;
const args = process.argv.slice(2);
const opt = (n) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : null);
const out = ensure(PROCESSED); // plot-ready CSVs
ensure(RESULTS); // hypothesis tests + data quality
const config = JSON.parse(readFileSync(CONFIG, 'utf8'));

// ---- load + validate ---------------------------------------------------------------------
const quality = [];
function load(run) {
  if (!run) return { ops: [], trials: [], cells: [], manifest: null };
  const dir = resolve(LOGS, run);
  const lines = readFileSync(resolve(RAW, run, 'events.jsonl'), 'utf8').split('\n').filter(Boolean);
  let bad = 0;
  const rows = [];
  for (const l of lines) {
    try { rows.push(JSON.parse(l)); } catch { bad++; }
  }
  const ops = rows.filter((r) => r.type === 'op');
  const trials = rows.filter((r) => r.type === 'trial');
  const cells = rows.filter((r) => r.type === 'cell_end');
  const invalid = ops.filter((o) => !(Number.isFinite(o.latencyMs) && o.latencyMs >= 0)).length;
  quality.push({
    run, lines: lines.length, unparseable: bad, ops: ops.length, trials: trials.length,
    warmupTrialsExcluded: trials.filter((t) => t.warmup).length, invalidLatency: invalid,
    errors: ops.filter((o) => o.outcome === 'error').length,
  });
  return {
    ops: ops.filter((o) => !o.warmup && Number.isFinite(o.latencyMs)),
    trials: trials.filter((t) => !t.warmup),
    cells,
    manifest: existsSync(resolve(dir, 'manifest.json')) ? JSON.parse(readFileSync(resolve(dir, 'manifest.json'), 'utf8')) : null,
  };
}

const neon = load(opt('neon'));
const lite = load(opt('pglite'));
const live = load(opt('live'));

const r2 = (x) => (Number.isFinite(x) ? +x.toFixed(2) : null);
const r4 = (x) => (Number.isFinite(x) ? +x.toFixed(4) : null);
function csv(name, rows) {
  if (!rows.length) return;
  const cols = Object.keys(rows[0]);
  const esc = (v) => (v === null || v === undefined ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  writeFileSync(resolve(out, name), [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n') + '\n');
}
const p95 = (xs) => quantile(xs, 0.95);
const by = (xs, f) => xs.reduce((m, x) => ((m[f(x)] ??= []).push(x), m), {});

// Completeness check against the pre-registered design.
for (const [exp, data] of [['E1', neon], ['E2', neon], ['E3', neon], ['E5', lite]]) {
  const e = config.experiments[exp];
  for (const s of e.strategies) for (const c of e.concurrency) {
    const got = data.trials.filter((t) => t.exp === exp && t.strategy === s && t.c === c).length;
    if (got && got !== e.trials) quality.push({ run: exp, warning: `${s} c=${c}: ${got}/${e.trials} trials` });
  }
}

const results = { hypotheses: {} };

// ---- E1 hot seat --------------------------------------------------------------------------
function hotSeatTable(data, exp) {
  const rows = [];
  for (const [key, ts] of Object.entries(by(data.trials.filter((t) => t.exp === exp), (t) => `${t.strategy}|${t.c}`))) {
    const [strategy, c] = key.split('|');
    const ops = data.ops.filter((o) => o.exp === exp && o.strategy === strategy && o.c === +c);
    const lat = ops.map((o) => o.latencyMs);
    const withDbl = ts.filter((t) => t.doubleBookings > 0).length;
    const [lo, hi] = wilsonCI(withDbl, ts.length);
    const aborts = ts.reduce((n, t) => n + (t.serializationFailures ?? 0) + (t.deadlocks ?? 0), 0);
    rows.push({
      experiment: exp, strategy, concurrency: +c, trials: ts.length, transactions: ops.length,
      mean_winners_per_trial: r2(mean(ts.map((t) => t.successes))),
      trials_with_double_booking: withDbl, p_double_booking: r4(withDbl / ts.length), p_ci_low: r4(lo), p_ci_high: r4(hi),
      double_bookings_total: ts.reduce((n, t) => n + t.doubleBookings, 0),
      double_bookings_per_trial: r2(mean(ts.map((t) => t.doubleBookings))),
      lost_updates_total: ts.reduce((n, t) => n + (t.lostUpdates ?? 0), 0),
      aborts_total: aborts, abort_rate: r4(aborts / Math.max(1, ops.length)),
      latency_p50_ms: r2(median(lat)), latency_p95_ms: r2(p95(lat)),
      latency_p95_ci_low: r2(bootstrapCI(lat, p95)[0]), latency_p95_ci_high: r2(bootstrapCI(lat, p95)[1]),
      makespan_median_ms: r2(median(ts.map((t) => t.makespanMs))),
    });
  }
  return rows.sort((a, b) => a.strategy.localeCompare(b.strategy) || a.concurrency - b.concurrency);
}
const e1 = hotSeatTable(neon, 'E1');
csv('e1_hot_seat.csv', e1);
csv('e1_transactions.csv', neon.ops.filter((o) => o.exp === 'E1').map((o) => ({ strategy: o.strategy, concurrency: o.c, trial: o.trial, client: o.client, outcome: o.outcome, sqlstate: o.sqlstate, latency_ms: o.latencyMs, start_offset_ms: o.offsetMs })));

// H1: the baseline double-books; H2: every other strategy never does.
{
  const naive = neon.trials.filter((t) => t.exp === 'E1' && t.strategy === 'naive');
  const cond = neon.trials.filter((t) => t.exp === 'E1' && t.strategy === 'conditional_update');
  const a = naive.filter((t) => t.doubleBookings > 0).length;
  const c = cond.filter((t) => t.doubleBookings > 0).length;
  results.hypotheses.H1 = {
    statement: 'Under contention the naive read-check-write baseline double-books (P > 0), while the conditional UPDATE does not.',
    naive: { trials: naive.length, withDoubleBooking: a, rate: r4(a / naive.length), ci: wilsonCI(a, naive.length).map(r4) },
    conditional_update: { trials: cond.length, withDoubleBooking: c },
    fisherExactP: fisherExact(a, naive.length - a, c, cond.length - c),
    supported: a > 0 && c === 0,
  };
  const correct = {};
  for (const s of config.experiments.E1.strategies.filter((x) => x !== 'naive')) {
    const ts = neon.trials.filter((t) => (t.exp === 'E1' || t.exp === 'E2') && t.strategy === s);
    const tx = neon.ops.filter((o) => (o.exp === 'E1' || o.exp === 'E2') && o.strategy === s).length;
    const dbl = ts.reduce((n, t) => n + t.doubleBookings, 0);
    correct[s] = { trials: ts.length, transactions: tx, doubleBookings: dbl, upper95_rate_per_trial: dbl === 0 ? r4(ruleOfThree(ts.length)) : null };
  }
  results.hypotheses.H2 = {
    statement: 'Every non-baseline strategy produces zero double bookings (E1+E2).',
    perStrategy: correct,
    supported: Object.values(correct).every((x) => x.doubleBookings === 0),
  };
}

// ---- E2 multi-seat --------------------------------------------------------------------------
const e2 = hotSeatTable(neon, 'E2').map((r) => {
  const ops = neon.ops.filter((o) => o.exp === 'E2' && o.strategy === r.strategy && o.c === r.concurrency);
  const count = (o) => ops.filter((x) => x.outcome === o).length;
  return {
    ...r,
    success: count('success'), conflict: count('conflict'), deadlock: count('deadlock'),
    serialization_failure: count('serialization_failure'), error: count('error'),
    seats_sold_per_trial: r2(mean(neon.trials.filter((t) => t.exp === 'E2' && t.strategy === r.strategy).map((t) => t.claimedSeats))),
  };
});
csv('e2_multi_seat.csv', e2);

// ---- E3 low contention: latency & throughput ------------------------------------------------
const e3 = [];
const e3tests = [];
for (const c of config.experiments.E3.concurrency) {
  const groups = {};
  for (const s of config.experiments.E3.strategies) {
    const ops = neon.ops.filter((o) => o.exp === 'E3' && o.strategy === s && o.c === c && o.outcome === 'success');
    const ts = neon.trials.filter((t) => t.exp === 'E3' && t.strategy === s && t.c === c);
    const lat = ops.map((o) => o.latencyMs);
    groups[s] = lat;
    const thr = ts.map((t) => (t.successes / t.makespanMs) * 1000);
    const [tlo, thi] = bootstrapCI(thr, mean);
    e3.push({
      experiment: 'E3', strategy: s, concurrency: c, transactions: lat.length,
      latency_p25_ms: r2(quantile(lat, 0.25)), latency_p50_ms: r2(median(lat)), latency_p75_ms: r2(quantile(lat, 0.75)),
      latency_p95_ms: r2(p95(lat)), latency_p50_ci_low: r2(bootstrapCI(lat, median)[0]), latency_p50_ci_high: r2(bootstrapCI(lat, median)[1]),
      throughput_tps_mean: r2(mean(thr)), throughput_ci_low: r2(tlo), throughput_ci_high: r2(thi),
      errors: neon.ops.filter((o) => o.exp === 'E3' && o.strategy === s && o.c === c && o.outcome !== 'success').length,
    });
  }
  const names = Object.keys(groups).filter((s) => groups[s].length);
  const kw = kruskalWallis(names.map((s) => groups[s]));
  const pairs = names.filter((s) => s !== 'conditional_update').map((s) => {
    const mw = mannWhitney(groups[s], groups.conditional_update);
    const cd = cliffsDelta(groups[s], groups.conditional_update);
    return { concurrency: c, comparison: `${s} vs conditional_update`, n1: groups[s].length, n2: groups.conditional_update.length, U: r2(mw.U), p_raw: mw.p, cliffs_delta: r4(cd.d), magnitude: cd.magnitude, median_diff_ms: r2(median(groups[s]) - median(groups.conditional_update)) };
  });
  holm(pairs.map((p) => p.p_raw)).forEach((p, i) => (pairs[i].p_holm = p));
  e3tests.push({ concurrency: c, kruskalWallis: { H: r2(kw.H), df: kw.df, p: kw.p }, pairwise: pairs });
}
csv('e3_low_contention.csv', e3);
csv('e3_pairwise_tests.csv', e3tests.flatMap((t) => t.pairwise.map((p) => ({ ...p, p_raw: p.p_raw.toExponential(3), p_holm: p.p_holm.toExponential(3) }))));
csv('e3_transactions.csv', neon.ops.filter((o) => o.exp === 'E3').map((o) => ({ strategy: o.strategy, concurrency: o.c, trial: o.trial, client: o.client, outcome: o.outcome, latency_ms: o.latencyMs })));
results.hypotheses.H3 = {
  statement: 'When requests do not collide, strategies differ in latency (Kruskal–Wallis), and coarse locking (advisory) is the slowest at c>1.',
  tests: e3tests,
};

// ---- E5 platform -----------------------------------------------------------------------------
const e5 = hotSeatTable(lite, 'E5');
csv('e5_platform_pglite.csv', e5);
{
  const n8 = neon.trials.filter((t) => t.exp === 'E1' && t.strategy === 'naive' && t.c === 8);
  const l8 = lite.trials.filter((t) => t.exp === 'E5' && t.strategy === 'naive' && t.c === 8);
  const a = n8.filter((t) => t.doubleBookings > 0).length;
  const b = l8.filter((t) => t.doubleBookings > 0).length;
  results.hypotheses.H5 = {
    statement: 'The test platform changes the observed outcome of the same buggy code (naive, c=8): networked Postgres vs embedded PGlite.',
    neon: { trials: n8.length, withDoubleBooking: a }, pglite: { trials: l8.length, withDoubleBooking: b },
    fisherExactP: n8.length && l8.length ? fisherExact(a, n8.length - a, b, l8.length - b) : null,
    supported: n8.length > 0 && l8.length > 0 ? a > 0 && b === 0 : null,
  };
}

// ---- E4 live ---------------------------------------------------------------------------------
if (live.ops.length) {
  const reads = live.ops.filter((o) => o.exp === 'E4a');
  const e4a = [];
  for (const [ep, rows] of Object.entries(by(reads, (o) => o.endpoint))) {
    const warm = rows.filter((o) => !o.first && o.status === 200).map((o) => o.latencyMs);
    const under = warm.filter((x) => x < 200).length;
    const [plo, phi] = bootstrapCI(warm, p95);
    const [ulo, uhi] = wilsonCI(under, warm.length);
    e4a.push({
      endpoint: ep, samples: warm.length, errors: rows.filter((o) => o.status !== 200).length,
      p50_ms: r2(median(warm)), p95_ms: r2(p95(warm)), p95_ci_low: r2(plo), p95_ci_high: r2(phi), max_ms: r2(Math.max(...warm)),
      share_under_200ms: r4(under / warm.length), share_ci_low: r4(ulo), share_ci_high: r4(uhi),
      first_request_ms: r2(median(rows.filter((o) => o.first).map((o) => o.latencyMs))),
      server_db_latency_median_ms: ep === 'health' ? r2(median(rows.map((o) => o.dbLatencyMs).filter(Number.isFinite))) : null,
    });
  }
  csv('e4a_live_latency.csv', e4a);
  csv('e4a_live_samples.csv', reads.map((o) => ({ endpoint: o.endpoint, round: o.trial, sample: o.sample ?? null, first: o.first, status: o.status, latency_ms: o.latencyMs, cache: o.cache ?? null, edge: o.vercelId ?? null })));
  const api = e4a.filter((r) => r.endpoint !== 'static');
  const net = e4a.find((r) => r.endpoint === 'static');
  results.hypotheses.H4 = {
    statement: 'Deployed read endpoints meet the PRD target p95 < 200 ms (warm, measured end-to-end from the client).',
    perEndpoint: api.map((r) => ({ endpoint: r.endpoint, p95: r.p95_ms, ci: [r.p95_ci_low, r.p95_ci_high], meets: r.p95_ci_high < 200 })),
    networkBaselineP50: net?.p50_ms ?? null,
    supported: api.every((r) => r.p95_ci_high < 200),
  };

  const race = live.trials.filter((t) => t.exp === 'E4b');
  csv('e4b_live_race.csv', race.map((t) => ({ trial: t.trial, clients: t.c, winners: t.successes, conflicts: t.conflicts, errors: t.errors, double_bookings: t.doubleBookings, makespan_ms: t.makespanMs, state_after_race: t.seatStateAfterRace, state_after_release: t.seatStateAfterRelease })));
  const idem = live.trials.filter((t) => t.exp === 'E4c');
  csv('e4c_live_idempotency.csv', idem.map((t) => ({ trial: t.trial, parallel_submits: t.attempts, http_200: t.successes, http_409: t.conflicts, payment_rows: t.paymentRows, successful_payments: t.successfulPayments, double_charges: t.doubleCharges, replay_status: t.replayStatus, replayed: t.replayFlag, after_cancel: t.cancelStatus })));
  const raceTx = live.ops.filter((o) => o.exp === 'E4b').map((o) => o.latencyMs);
  results.live = {
    race: {
      trials: race.length, exactlyOneWinner: race.filter((t) => t.successes === 1).length,
      doubleBookings: race.reduce((n, t) => n + t.doubleBookings, 0), errors: race.reduce((n, t) => n + t.errors, 0),
      upper95_rate: r4(ruleOfThree(race.length)), holdLatencyP50: r2(median(raceTx)), holdLatencyP95: r2(p95(raceTx)),
      allReleased: race.every((t) => t.seatStateAfterRelease === 'AVAILABLE'),
    },
    idempotency: {
      trials: idem.length, submits: idem.reduce((n, t) => n + t.attempts, 0), doubleCharges: idem.reduce((n, t) => n + t.doubleCharges, 0),
      oneSuccessfulPaymentEveryTrial: idem.every((t) => t.successfulPayments === 1), replaysFlagged: idem.filter((t) => t.replayFlag === true).length,
    },
  };
}

results.dataQuality = quality;
results.environment = { neon: neon.manifest && { ...neon.manifest, config: undefined }, pglite: lite.manifest && { ...lite.manifest, config: undefined }, live: live.manifest };
if (neon.manifest) {
  const rtt = neon.manifest.networkRttMs.samples;
  results.environment.neonRttMedianMs = r2(median(rtt));
}
writeFileSync(resolve(RESULTS, 'results.json'), JSON.stringify(results, null, 2));
csv('../../experiments/results/data_quality.csv', quality.map((q) => ({ run: q.run, lines: q.lines ?? '', unparseable: q.unparseable ?? '', ops: q.ops ?? '', trials: q.trials ?? '', warmup_excluded: q.warmupTrialsExcluded ?? '', invalid_latency: q.invalidLatency ?? '', error_outcomes: q.errors ?? '', warning: q.warning ?? '' })));
console.log(JSON.stringify({ H1: results.hypotheses.H1?.supported, H2: results.hypotheses.H2?.supported, H4: results.hypotheses.H4?.supported, H5: results.hypotheses.H5?.supported }, null, 0));
console.log(`wrote ${out}`);
