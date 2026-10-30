# Load-test results

> **Status: not yet run against the deployed stack.** Fill this in after deploying
> (Render/Railway + Neon). Report *warm* numbers and say so — Neon's free tier
> suspends when idle and the first query after a pause is slow.

## How to run

```bash
# install k6: https://grafana.com/docs/k6/latest/set-up/install-k6/
k6 run loadtest/k6-read.js  -e BASE_URL=https://<your-api-host>
k6 run loadtest/k6-holds.js -e BASE_URL=https://<your-api-host>
```

## Environment

| | |
|---|---|
| Date | _YYYY-MM-DD_ |
| API host | _e.g. Render free / starter, region_ |
| Database | _Neon, region, compute size, pooled connection (`-pooler`)_ |
| Load generator | _machine, CPU, RAM, network, distance to API region_ |
| Commit | _git sha_ |

## Read endpoints — 100 VUs, 60 s (target p95 < 200 ms)

| Endpoint | RPS | p50 | p95 | p99 | errors |
|---|---|---|---|---|---|
| `GET /movies` | | | | | |
| `GET /movies/:id` | | | | | |
| `GET /movies/:id/showtimes` | | | | | |
| `GET /showtimes/:id/seats` | | | | | |

## Write path — 50 VUs, 60 s (target p95 < 400 ms)

| Endpoint | RPS | p50 | p95 | p99 | 201 | 409 | other |
|---|---|---|---|---|---|---|---|
| `POST /showtimes/:id/holds` | | | | | | | |

## Notes

- _What was cached (movie listing/detail: 60 s in-process LRU; seat map: never)._
- _Anything that missed the target and why._
