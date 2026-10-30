# System architecture

CineBook has two parts: the **booking application** (the system under study) and the **research harness**
(the apparatus that measures it).

## 1. Booking application

```mermaid
flowchart LR
  U[Browser] -->|HTTPS| CDN[Vercel CDN<br/>React SPA: Vite + React Router + TanStack Query]
  U -->|/api/v1/* REST + JWT| FN[Vercel Function<br/>Express API · Zod validation<br/>auth · holds · payments]
  FN -->|SQL, pooled| DB[(Neon PostgreSQL 18<br/>ap-southeast-1)]
  FN -. admin sync only .-> TMDB[TMDB API]
```

| Layer | Technology | Location |
|---|---|---|
| Web client | React 18, Vite, React Router, TanStack Query, Tailwind, React Hook Form + Zod | `apps/web/` |
| API | Node.js, Express 4, TypeScript, Drizzle ORM, JWT with SQL-backed sessions | `apps/api/` |
| Shared contract | Zod schemas, pricing and payment rules, API types (used by both sides) | `packages/shared/` |
| Database | Neon PostgreSQL (production); embedded PGlite for local development and tests | `apps/api/src/db/` |
| Deployment | One Vercel project: static site on the CDN plus one function at `/api/*` (Build Output API) | `vercel.json`, `scripts/build-vercel.mjs` |

### Seat-hold protocol (the property under study)

```mermaid
sequenceDiagram
  participant A as Buyer A
  participant B as Buyer B
  participant API
  participant PG as PostgreSQL
  A->>API: POST /showtimes/:id/holds {seatIds:[E7]}
  B->>API: POST /showtimes/:id/holds {seatIds:[E7]}
  API->>PG: UPDATE show_seats SET status='HELD' WHERE seat=E7 AND (AVAILABLE OR hold expired) RETURNING
  API->>PG: same UPDATE (waits on A's row lock)
  PG-->>API: A: 1 row → INSERT booking PENDING → COMMIT
  API-->>A: 201 {bookingId, holdExpiresAt, pricing}
  PG-->>API: B: row re-checked after A commits → no longer AVAILABLE → 0 rows
  API-->>B: 409 SEATS_UNAVAILABLE
```

* **Seat state table.** `show_seats` holds one row per seat per showtime, with primary key `(showtime_id, seat_id)`.
* **Atomic holds.** A hold is one conditional `UPDATE`, all-or-nothing: if fewer rows are updated than requested, the transaction rolls back and the API returns 409.
* **Expired holds.** Expired holds are reclaimable inline, so correctness never depends on the clean-up sweeper.
* **Idempotent payment.** Payment requires an `Idempotency-Key` header, and the key column is unique. A partial unique index allows at most one in-flight or successful payment per booking. On success, `HELD` changes to `BOOKED` only where the hold is still valid; otherwise the payment is refunded and the API returns 410.
* **Overlapping shows.** An `EXCLUDE USING gist` constraint makes it impossible to schedule two overlapping shows on the same screen.

### Data model

`users` · `sessions` (refresh-token hashes, rotation families) · `cities` · `theatres` · `screens` · `seat_tiers` ·
`seats` · `movies` · `cast_members` · `showtimes` · `show_seats` · `bookings` · `booking_seats` · `payments`.
The full schema is in [`apps/api/src/db/migrations/0001_init.ts`](../apps/api/src/db/migrations/0001_init.ts).

## 2. Research harness

```mermaid
flowchart LR
  CFG[experiments/configs/<br/>experiments.json] --> RUN[harness/runner.mjs<br/>E1–E3, E5]
  CFG --> LIVE[harness/live.mjs<br/>E4 on the deployed site]
  RUN -->|one line per transaction| RAW[(data/raw/&lt;run&gt;/<br/>events.jsonl)]
  LIVE --> RAW
  RUN --> MAN[experiments/logs/&lt;run&gt;/<br/>manifest.json]
  RAW --> DASH[experiments/dashboard<br/>live charts via SSE]
  RAW --> AN[harness/analyze.mjs]
  AN --> PROC[data/processed/*.csv]
  AN --> RES[experiments/results/<br/>results.json]
  PROC --> FIG[harness/charts.mjs → figures/]
  PROC --> NB[notebooks/ 01–04<br/>SciPy/Statsmodels cross-check]
  FIG --> REP[docs/research-report.pdf]
```

* **Isolation.** The strategies run against a separate `research` schema in the same database, so the application's tables are never touched by experiments E1–E3 and E5.
* **Live test accounts.** E4 uses accounts named `research+<run>-<n>@cinebook.test`. They are deleted, with their bookings and payments, at the end of each run.
* **Dashboard.** `node experiments/dashboard/server.mjs` follows the newest raw log (named in `experiments/logs/LATEST`) and streams new lines to the browser.
