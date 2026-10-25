# CineBook concurrency research — reproducibility kit

Everything needed to re-run, audit or extend the study in [`report/REPORT.md`](report/REPORT.md).

```
research/
  config/experiments.json   pre-registered design: factors, levels, replications, seed
  src/strategies.mjs        the 7 concurrency-control strategies under test
  src/runner.mjs            DB experiments E1–E3 (Neon) and E5 (PGlite)
  src/live.mjs              E4: tests against the deployed site (Vercel + Neon)
  src/stats.mjs             statistics (self-test: node research/src/stats.mjs)
  src/analyze.mjs           validation, cleaning, CSVs, hypothesis tests → analysis/
  src/charts.mjs            figures → report/figures/
  dashboard/                live dashboard (Server-Sent Events + Chart.js)
  results/<run>/            raw logs: events.jsonl (every transaction + trial) + manifest.json
  analysis/                 plot-ready CSVs + results.json
  report/                   REPORT.md, report.pdf, figures/
```

## Re-run

Requirements: Node 20+, `npm ci` at the repo root, and `DATABASE_URL` (a Postgres
connection string) in `apps/api/.env`. The experiments only touch the separate
`research` schema; the application's tables are never used by E1–E3/E5.

```bash
node research/src/stats.mjs                                  # 1. statistics self-test (12 checks)
node research/dashboard/server.mjs                           # 2. optional: live dashboard → http://localhost:4600
node research/src/runner.mjs --exp E1,E2,E3 --run main-neon  # 3. database experiments (~25 min)
node research/src/runner.mjs --exp E5 --run main-pglite      # 4. platform comparison (~1 min)
node research/src/live.mjs --run main-live                   # 5. live tests on the deployed site (~8 min)
node research/src/analyze.mjs --neon main-neon --pglite main-pglite --live main-live
node research/src/charts.mjs
node research/src/build-report.mjs                           # 6. report.pdf from REPORT.md
```

Add `--quick` to the runner for a 3-trial smoke test.

## What is recorded

Every transaction attempt (`type: "op"`): experiment, strategy, concurrency, trial, client,
requested seats, outcome (`success | conflict | deadlock | serialization_failure | error`),
SQLSTATE, error message, latency, start offset within the trial, wall-clock timestamp, and a
monotonic sequence number.

Every trial (`type: "trial"`): makespan, counts per outcome, double bookings, lost updates,
claimed seats, client CPU time and memory.

Every configuration (`type: "cell_end"`): server-side deltas from `pg_stat_database`
(commits, rollbacks, deadlocks, rows updated/inserted).

`manifest.json`: git commit and dirty flag, Node version, OS, CPU, RAM, database host,
pooled or not, server version and default isolation, network RTT samples, the full
config, and the randomised execution order.

## Notes on determinism

Inputs (seat choices, request order, cell execution order) derive from the fixed seed in
`experiments.json`, so they are identical on every run. Outcomes depend on real timing and
are not deterministic; the analysis therefore reports intervals, not single numbers. A
re-run is expected to reproduce every *qualitative* conclusion, and the latency figures
within their confidence intervals on comparable network conditions.
