# Reproducibility

Everything needed to audit, re-run or extend the study is in this repository.
The CI job `research` re-checks the analysis on every push.

## What is versioned

| Artifact | Location |
|---|---|
| Pre-registered design (factors, levels, replications, seed) | `experiments/configs/experiments.json` |
| Treatments (the 7 strategies) | `experiments/harness/strategies.mjs` |
| Experiment runners | `experiments/harness/runner.mjs` (E1–E3, E5), `experiments/harness/live.mjs` (E4) |
| Raw data: one line per transaction, trial and configuration | `data/raw/<run>/events.jsonl` |
| Run manifests: git commit, versions, hardware, DB host, network RTT, execution order | `experiments/logs/<run>/manifest.json` |
| Processed tables (plot-ready CSV) | `data/processed/` |
| Hypothesis tests and data-quality checks | `experiments/results/` |
| Figures and their generator | `figures/`, `experiments/harness/charts.mjs` |
| Independent re-analysis (Python) | `notebooks/` |
| Report and literature review (source + PDF) | `docs/report-source/`, `docs/*.pdf` |
| Dependency versions | `package-lock.json` (Node), `requirements.txt` (Python) |

## Level 1: verify the analysis from the committed data (about 2 minutes, no database needed)

```bash
npm ci
npm run stats:selftest            # 12 checks against published reference values
npm run experiments:analyze       # raw logs → data/processed + experiments/results
git diff --exit-code -- data/processed experiments/results   # no output = identical results
npm run experiments:figures       # → figures/
npm run report:build              # → docs/research-report.pdf/.docx, docs/literature-review.pdf/.docx
```

Independent cross-check in Python:

```bash
python -m venv .venv
.venv/Scripts/pip install -r requirements.txt        # Windows   (macOS/Linux: .venv/bin/pip)
cd notebooks
../.venv/Scripts/jupyter nbconvert --to notebook --execute --inplace 04_statistical_analysis.ipynb
# the last cell asserts that all 154 recomputed quantities agree with the Node analysis
```

## Level 2: re-run the experiments (about 30 minutes)

Requirements: Node 20+, and a PostgreSQL connection string in `apps/api/.env` (`DATABASE_URL=…`).
The experiments create and use only the `research` schema; application tables are never touched.

```bash
npm run experiments:dashboard     # optional: live dashboard → http://localhost:4600
npm run experiments:run           # E1–E3 on the configured Postgres (~25 min)
npm run experiments:platform      # E5 on embedded PGlite (~1 min)
npm run experiments:live          # E4 against the deployed site (~8 min, cleans up after itself)
npm run experiments:analyze && npm run experiments:figures && npm run report:build
```

The extended study (E6–E12, about 45 minutes) uses one script per experiment:

```bash
npm run experiments:web           # E6 public pages: CineBook, BookMyShow, District (--site CineBook re-audits only ours)
npm run experiments:ux            # E7 booking funnel, KLM, keyboard-only booking (live, cleans up)
npm run experiments:scale         # E8 10/50/100/500 concurrent users (live, ~500 research accounts, cleans up)
npm run experiments:reliability   # E9 failure injection (live, cleans up)
npm run experiments:db            # E10 1 M-row synthetic schema research_e10 on Neon (dropped afterwards)
npm run experiments:security      # E11 OWASP API Top 10 checks (local PGlite API + live headers)
npm run experiments:recsim        # E12 recommender simulation (offline, seeded)
```

E7's keyboard results before and after the accessibility fixes are kept as the runs
`main-ux-prefix`, `main-ux-midfix` and `main-ux`; E6's post-fix audit is `main-web-postfix`.
SUS needs human participants: see [`experiments/ux/`](../experiments/ux/README.md).

Add `--quick` to the runner for a 3-trial smoke test:
`node experiments/harness/runner.mjs --exp E1 --quick --run smoke`.

## Determinism

* **Inputs** (seat choice, request order, cell execution order) derive from the fixed seed, so they are identical on every run.
* **Analysis** is deterministic: the bootstrap uses a seeded generator, so re-running it on the same raw data gives byte-identical results.
* **Outcomes** depend on real timing and network conditions, so a re-run of the *experiments* is expected to reproduce every qualitative conclusion, with latencies within their confidence intervals under similar network conditions.
