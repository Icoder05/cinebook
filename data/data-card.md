# Data card — CineBook concurrency experiments

| | |
|---|---|
| **What** | Transaction-level logs of seat-reservation experiments on PostgreSQL, plus end-to-end measurements of the deployed CineBook site |
| **Collected** | 25 Oct 2026 (UTC), by the scripts in `experiments/harness/` |
| **Size** | 3 runs · 13 228 log lines · 12 402 transaction records · 687 trial records |
| **Format** | JSON Lines (raw), CSV (processed) |
| **Personal data** | None. The live test accounts used synthetic emails (`research+…@cinebook.test`) and were deleted after the run. |
| **Licence** | Same as the repository (MIT). The movie catalogue in the application is *not* part of this dataset. |

## Runs

| Run | Platform | Experiments | Raw log | Manifest |
|---|---|---|---|---|
| `main-neon` | Neon PostgreSQL 18.6, ap-southeast-1, pooled connections | E1, E2, E3 | `raw/main-neon/events.jsonl` (12 020 lines) | `experiments/logs/main-neon/manifest.json` |
| `main-pglite` | embedded PGlite (WASM, single connection) | E5 | `raw/main-pglite/events.jsonl` (443 lines) | `experiments/logs/main-pglite/manifest.json` |
| `main-live` | production site (Vercel function in sin1 + Neon) | E4a–E4c | `raw/main-live/events.jsonl` (765 lines) | `experiments/logs/main-live/manifest.json` |
| `main-web`, `main-web-postfix` | public pages of CineBook, BookMyShow, District (Chromium) | E6 | 57 + 35 lines | `experiments/logs/main-web*/` |
| `main-ux-prefix`, `main-ux-midfix`, `main-ux` | production site before, during and after the accessibility fixes | E7 | 8 + 18 + 18 lines | `experiments/logs/main-ux*/` |
| `main-scale` | production site | E8 | 13 936 lines | `experiments/logs/main-scale/` |
| `main-reliability` | production site | E9 | 101 lines | `experiments/logs/main-reliability/` |
| `main-dbopt` | Neon, synthetic schema `research_e10` (dropped afterwards) | E10 | 624 lines | `experiments/logs/main-dbopt/` |
| `main-security` | local API on in-memory PGlite + live headers | E11 | 49 lines | `experiments/logs/main-security/` |
| `main-recsim` | offline simulation, 2 000 synthetic personas | E12 | 24 008 lines | `experiments/logs/main-recsim/` |

## Raw record types (`raw/<run>/events.jsonl`)

Every line has `runId`, `seq` (monotonic), `ts` (ISO-8601 UTC) and `type`.

| `type` | Fields |
|---|---|
| `op` (one transaction attempt) | `exp`, `strategy`, `c`, `trial`, `warmup`, `client`, `seats`, `outcome` (`success` / `conflict` / `deadlock` / `serialization_failure` / `error`), `sqlstate`, `error`, `latencyMs`, `offsetMs` (start offset within the trial). Live records add `endpoint`, `status`, `cache`, `vercelId`, `dbLatencyMs`, `bytes`, `code`. |
| `trial` | `makespanMs`, `attempts`, `successes`, `conflicts`, `deadlocks`, `serializationFailures`, `errors`, `doubleBookings`, `lostUpdates`, `oversoldSeats`, `claimedSeats`, `clientCpuMs`, `rssMb`, `startedAt`. Live records add `seatStateAfterRace`, `seatStateAfterRelease`, `paymentRows`, `doubleCharges`, `replayFlag`, `cancelStatus`. |
| `cell_start` / `cell_end` | one configuration; `cell_end.serverStats` holds `pg_stat_database` deltas (commits, rollbacks, deadlocks, rows updated and inserted) |
| `run_start` / `progress` / `run_end` / `cleanup` | run bookkeeping |

## Processed tables (`processed/*.csv`)

| File | One row per | Key columns |
|---|---|---|
| `e1_hot_seat.csv` | strategy × *c* | trials, `trials_with_double_booking`, `p_double_booking` + Wilson CI, `double_bookings_total`, `abort_rate`, `latency_p50_ms`, `latency_p95_ms` + bootstrap CI, `makespan_median_ms` |
| `e1_transactions.csv`, `e3_transactions.csv` | transaction | strategy, concurrency, trial, client, outcome, `latency_ms` (for custom plots) |
| `e2_multi_seat.csv` | strategy | as E1 plus success / conflict / deadlock / serialization_failure counts and `seats_sold_per_trial` |
| `e3_low_contention.csv` | strategy × *c* | latency quartiles and p95, median CI, `throughput_tps_mean` + CI |
| `e3_pairwise_tests.csv` | comparison | Mann–Whitney U, raw and Holm-adjusted p, Cliff's δ and magnitude, median difference |
| `e4a_live_latency.csv` / `e4a_live_samples.csv` | endpoint / request | p50, p95 + CI, share under 200 ms + Wilson CI / every sample with edge id and cache status |
| `e4b_live_race.csv`, `e4c_live_idempotency.csv` | live trial | winners, conflicts, double bookings, seat state / payment rows, double charges, replay flag |
| `e5_platform_pglite.csv` | strategy | as E1, on PGlite |
| `e6_web_perf.csv`, `e6_accessibility.csv`, `e6_responsive.csv` | page / page × phase / page × width | LCP mean ± SD + t CI, FCP, TTFB, bytes by type, requests, third-party hosts / axe violations by impact / overflow px |
| `e7_funnel.csv`, `e7_keyboard.csv` | device / keyboard run | screens, clicks, keystrokes, system time ± SD + CI, KLM times, stage times / completed, Tab presses, invisible-focus stops |
| `e8_scalability.csv`, `e8_repeats.csv` | workload × users / repeat | errors + Wilson bound, p50/p95/p99, throughput mean ± SD + t CI |
| `e9_reliability.csv` | scenario | passed + Wilson CI, charges, refunds, latency and recovery mean ± SD, final states |
| `e10_db_optimisation.csv`, `e10_tests.csv`, `e10_sizes.csv` | query × variant / comparison / object | mean ± SD + CI, median, p95, speed-up, plan / Mann–Whitney + Holm, Cliff's δ / MB |
| `e11_security.csv`, `e11_summary.csv` | check / OWASP category | expected, observed, pass |
| `e12_recsim.csv`, `e12_tests.csv` | noise × policy / comparison | HR@3, MRR, NDCG@5, rows scrolled (mean ± SD + CI) / paired Wilcoxon z, Holm p, effect size r |

## Quality

Completeness and validity were checked against the pre-registered design: no unparseable lines, no invalid
latencies, no missing cells, and 39 + 3 warm-up trials excluded ([`experiments/results/data_quality.csv`](../experiments/results/data_quality.csv)).

## Known limitations

* **Single client location.** Latencies include the round trip from a single client in India.
* **One database configuration.** The data reflect one Neon compute size, through a connection pooler.
* **Non-deterministic outcomes.** Timing-dependent results vary between re-runs, so the analysis reports intervals rather than single values.
