# Methodology

This document records the experimental design **as fixed before any data were collected**.
The machine-readable version is [`experiments/configs/experiments.json`](../experiments/configs/experiments.json);
the analysis reads that file and flags any cell whose trial count differs from the plan.

## Research questions and hypotheses

| | Research question | Hypothesis | Verdict |
|---|---|---|---|
| RQ1 | Does each strategy prevent double booking when clients request the same seat at the same instant? | **H1** the naive baseline double-books; **H2** every database-enforced strategy never does | H1 ✅ H2 ✅ |
| RQ2 | What latency and throughput does each correct strategy cost when requests do not collide? | **H3** strategies differ; the single conditional UPDATE is fastest, the coarse lock slowest | ✅ |
| RQ3 | How do strategies behave when clients request several overlapping seats? | unordered locking deadlocks; SERIALIZABLE over-aborts | ✅ |
| RQ4 | Is the deployed system correct and within the PRD target p95 < 200 ms? | **H4** yes, for every read endpoint | partially (3 of 4 endpoints) |
| RQ5 | Does the test platform change the observed outcome? | **H5** an embedded, serial database hides the race | ✅ |

## Experiment documentation

| Item | This study |
|---|---|
| **Hypotheses** | H1–H5 above |
| **Independent variables** | concurrency-control strategy (7 levels); concurrent clients *c* (1, 2, 8, 16, 32); workload shape (one hot seat / overlapping 3-of-10 seats / no collisions); platform (Neon PostgreSQL vs embedded PGlite) |
| **Dependent variables** | double bookings per trial; lost updates; abort rate by cause (deadlock `40P01`, serialization failure `40001`); seats sold; per-transaction latency (p50, p95); trial makespan; throughput (successful holds per second); server-side commits, rollbacks and deadlocks |
| **Controls / baseline** | the naive read-check-write strategy is the baseline; identical tables, schema and indexes for every strategy; fresh seats per trial; one dedicated connection per client; all clients released from a barrier at the same instant |
| **Repetitions** | 20 trials per cell (E1), 15 (E2, E5), 6 × 5 holds per client (E3); one extra warm-up trial per cell, logged but excluded |
| **Randomisation** | cells execute in a seeded random order (setup randomisation against time-of-day drift); seat choices and request orders derive from a fixed seed (`20261025`) |
| **Analysis** | medians and 95th percentiles with percentile-bootstrap CIs; Wilson intervals for proportions; rule of three for zero-event outcomes; Fisher's exact test; Kruskal–Wallis, then Mann–Whitney U with Holm correction; Cliff's δ effect sizes |
| **Validation** | statistics module self-test against 12 published reference values; full independent recomputation in SciPy/Statsmodels (`notebooks/04_statistical_analysis.ipynb`, 154/154 quantities agree); data-completeness check against this design |

## Experiments

| ID | Purpose | Workload | Strategies | *c* | Trials / cell |
|---|---|---|---|---|---|
| E1 | correctness under contention + **sensitivity** to *c* | one hot seat; every client requests it | 7 | 2, 8, 32 | 20 |
| E2 | deadlocks, aborts, seats sold | pool of 10 seats; each client asks for 3 random seats in random order | 6 | 16 | 15 |
| E3 | cost without collisions (latency, throughput) | each client books its own seats, 5 sequential holds | 6 | 1, 16 | 6 |
| E4 | the deployed system, end to end over HTTPS | read latency (3 rounds × 40 samples × 4 endpoints); 16-user race for one seat; 5 parallel payment submits with one idempotency key | production code | 1 / 16 / 5 | 3 / 12 / 6 |
| E5 | **platform sensitivity** | as E1 | 3 | 8 | 15 |

## Strategies (the treatments)

| Strategy | Mechanism |
|---|---|
| `naive` (baseline) | `SELECT status`; check in application code; unconditional `UPDATE` |
| `conditional_update` | CineBook's production logic: one `UPDATE … WHERE status = 'AVAILABLE' RETURNING`; all-or-nothing by comparing the row count |
| `pessimistic_sorted` | `SELECT … FOR UPDATE` on all requested seats in one statement, ordered by seat |
| `pessimistic_unordered` | `SELECT … FOR UPDATE` one seat at a time in the client's request order |
| `optimistic_version` | lock-free read of status and version; `UPDATE … WHERE version = <read version>` |
| `serializable` | the naive code under `SERIALIZABLE` (PostgreSQL SSI) |
| `advisory_lock` | `pg_advisory_xact_lock(show)`, then the naive code |

Implementation: [`experiments/harness/strategies.mjs`](../experiments/harness/strategies.mjs).
Every successful hold also inserts one *claim* row per seat in the same transaction, so double bookings
are counted directly as D = Σₛ max(0, nₛ − 1), where nₛ is the number of committed claims on seat s.

## Ablations and sensitivity analysis

* **Ablation: lock ordering.** `pessimistic_sorted` vs `pessimistic_unordered` differ only in lock order.
  Removing the consistent order raised the E2 deadlock rate from 0% to 38.8%.
* **Ablation: isolation level.** `naive` vs `serializable` run identical code. Raising the isolation level
  turned 38 double bookings per trial (E2) into zero, at the cost of a 93.8% abort rate.
* **Sensitivity: concurrency.** E1 varies *c* across 2, 8 and 32: baseline damage grows as c − 1, and p95
  latency of the correct strategies grows from about 0.45 s to about 3 s.
* **Sensitivity: platform.** E5 repeats E1 on embedded PGlite, where the same baseline never fails.

## Data collection

Every transaction attempt, every trial and every configuration is appended to a JSON-lines log with a run id,
monotonic sequence number and timestamp (see [`data/data-card.md`](../data/data-card.md)). Each run also writes a
manifest with the git commit, software versions, hardware, database host, network round-trip samples and the
randomised execution order ([`experiments/logs/`](../experiments/logs)).

## Threats to validity

* **External validity.**
  - All load came from one client in India, with a median round trip of 102 ms to the database in Singapore.
  - Relative differences between strategies generalise better than absolute latencies.
* **Construct validity.**
  - The strategies run without automatic retries. With retries, SERIALIZABLE and optimistic control would sell more seats, at higher latency.
  - "Conflict" outcomes (a correct refusal) are counted separately from errors.
* **Internal validity.**
  - Neon is a shared cloud service.
  - Randomised execution order and warm-up exclusion reduce time-of-day and warm-up effects, but do not remove them.
* **Statistical conclusion validity.**
  - The live samples are small (12 races, 6 payment trials), so the live run confirms rather than establishes correctness.
  - The 20-trial database experiments carry the statistical weight.
