# Tests

The tests sit next to the code they check (the standard layout for a TypeScript monorepo).
This page lists every suite and how to run it.

| Suite | Location | What it checks | Run |
|---|---|---|---|
| Unit | `packages/shared/src/shared.test.ts` | pricing in integer paise, GST, Luhn, card and UPI rules, Zod schemas | `npm test -w @cinebook/shared` |
| API integration | `apps/api/test/*.test.ts` | auth (refresh rotation, reuse detection, logout-all), catalogue, holds, payments, cancellation, sweeper; **50 concurrent requests for one seat → exactly 1 success, 49 × 409** | `npm test -w @cinebook/api` |
| End-to-end | `tests/e2e/happy-path.spec.ts` | sign-up → seats → payment → QR ticket, and the declined-card path, on desktop and mobile (Playwright) | `npm run test:e2e` |
| Statistics self-test | `experiments/harness/stats.mjs` | 12 checks of the statistics module against published reference values | `npm run stats:selftest` |
| Analysis cross-validation | `notebooks/04_statistical_analysis.ipynb` | recomputes 154 reported quantities with SciPy/Statsmodels and asserts agreement with the Node analysis | see [`docs/reproducibility.md`](../docs/reproducibility.md) |

`npm test` runs the unit and API suites. The API suite uses in-memory PGlite by default. Set
`TEST_DATABASE_URL` to a throwaway Postgres branch to run the concurrency test against a truly
concurrent server: E5 of the study shows that an embedded, serial database cannot reveal race conditions.
