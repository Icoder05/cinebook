// The seven concurrency-control strategies under test. Each receives a dedicated
// connection and tries to hold `seats` for `clientId` in trial `trial`, all-or-nothing.
// A successful hold also inserts one row per seat into research.claims inside the same
// transaction; a seat with more than one claim after a trial is a double booking.

const SCHEMA = 'research';

export const CODES = {
  '40P01': 'deadlock',
  '40001': 'serialization_failure',
  '55P03': 'lock_not_available',
};

async function claim(db, trial, seats, clientId) {
  await db.query(
    `INSERT INTO ${SCHEMA}.claims (trial_id, seat_no, client) SELECT $1, s, $2 FROM unnest($3::int[]) AS s`,
    [trial, clientId, seats],
  );
}

async function readCheck(db, trial, seats) {
  const r = await db.query(
    `SELECT seat_no, status, version FROM ${SCHEMA}.show_seats WHERE trial_id = $1 AND seat_no = ANY($2::int[])`,
    [trial, seats],
  );
  return r.rows;
}

const conflict = () => ({ outcome: 'conflict' });

export const strategies = {
  /** Baseline: read, decide in the application, write unconditionally. */
  async naive(db, { trial, seats, clientId }) {
    await db.query('BEGIN');
    const rows = await readCheck(db, trial, seats);
    if (rows.length !== seats.length || rows.some((r) => r.status !== 'AVAILABLE')) {
      await db.query('ROLLBACK');
      return conflict();
    }
    await db.query(
      `UPDATE ${SCHEMA}.show_seats SET status = 'HELD', held_by = $3, version = version + 1
        WHERE trial_id = $1 AND seat_no = ANY($2::int[])`,
      [trial, seats, clientId],
    );
    await claim(db, trial, seats, clientId);
    await db.query('COMMIT');
    return { outcome: 'success' };
  },

  /** CineBook: the database decides in a single conditional UPDATE. */
  async conditional_update(db, { trial, seats, clientId }) {
    await db.query('BEGIN');
    const r = await db.query(
      `UPDATE ${SCHEMA}.show_seats SET status = 'HELD', held_by = $3, version = version + 1
        WHERE trial_id = $1 AND seat_no = ANY($2::int[]) AND status = 'AVAILABLE'
        RETURNING seat_no`,
      [trial, seats, clientId],
    );
    if (r.rowCount !== seats.length) {
      await db.query('ROLLBACK');
      return conflict();
    }
    await claim(db, trial, seats, clientId);
    await db.query('COMMIT');
    return { outcome: 'success' };
  },

  /** Lock every requested row in one ordered statement, then check and write. */
  async pessimistic_sorted(db, { trial, seats, clientId }) {
    await db.query('BEGIN');
    const r = await db.query(
      `SELECT seat_no, status FROM ${SCHEMA}.show_seats
        WHERE trial_id = $1 AND seat_no = ANY($2::int[]) ORDER BY seat_no FOR UPDATE`,
      [trial, seats],
    );
    if (r.rows.length !== seats.length || r.rows.some((x) => x.status !== 'AVAILABLE')) {
      await db.query('ROLLBACK');
      return conflict();
    }
    await db.query(
      `UPDATE ${SCHEMA}.show_seats SET status = 'HELD', held_by = $3, version = version + 1
        WHERE trial_id = $1 AND seat_no = ANY($2::int[])`,
      [trial, seats, clientId],
    );
    await claim(db, trial, seats, clientId);
    await db.query('COMMIT');
    return { outcome: 'success' };
  },

  /** Lock rows one by one in the order the client asked for them (no global order). */
  async pessimistic_unordered(db, { trial, seats, clientId }) {
    await db.query('BEGIN');
    for (const s of seats) {
      const r = await db.query(
        `SELECT status FROM ${SCHEMA}.show_seats WHERE trial_id = $1 AND seat_no = $2 FOR UPDATE`,
        [trial, s],
      );
      if (!r.rows[0] || r.rows[0].status !== 'AVAILABLE') {
        await db.query('ROLLBACK');
        return conflict();
      }
    }
    await db.query(
      `UPDATE ${SCHEMA}.show_seats SET status = 'HELD', held_by = $3, version = version + 1
        WHERE trial_id = $1 AND seat_no = ANY($2::int[])`,
      [trial, seats, clientId],
    );
    await claim(db, trial, seats, clientId);
    await db.query('COMMIT');
    return { outcome: 'success' };
  },

  /** Optimistic: read versions lock-free, then write only if nothing changed since. */
  async optimistic_version(db, { trial, seats, clientId }) {
    const rows = await readCheck(db, trial, seats); // autocommit read, no locks
    if (rows.length !== seats.length || rows.some((r) => r.status !== 'AVAILABLE')) return conflict();
    await db.query('BEGIN');
    const r = await db.query(
      `UPDATE ${SCHEMA}.show_seats AS t SET status = 'HELD', held_by = $3, version = t.version + 1
         FROM unnest($2::int[], $4::int[]) AS v(seat_no, version)
        WHERE t.trial_id = $1 AND t.seat_no = v.seat_no AND t.version = v.version
        RETURNING t.seat_no`,
      [trial, rows.map((x) => x.seat_no), clientId, rows.map((x) => x.version)],
    );
    if (r.rowCount !== seats.length) {
      await db.query('ROLLBACK');
      return conflict();
    }
    await claim(db, trial, seats, clientId);
    await db.query('COMMIT');
    return { outcome: 'success' };
  },

  /** The naive code under SERIALIZABLE: SSI aborts one of two conflicting transactions. */
  async serializable(db, { trial, seats, clientId }) {
    await db.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    const rows = await readCheck(db, trial, seats);
    if (rows.length !== seats.length || rows.some((r) => r.status !== 'AVAILABLE')) {
      await db.query('ROLLBACK');
      return conflict();
    }
    await db.query(
      `UPDATE ${SCHEMA}.show_seats SET status = 'HELD', held_by = $3, version = version + 1
        WHERE trial_id = $1 AND seat_no = ANY($2::int[])`,
      [trial, seats, clientId],
    );
    await claim(db, trial, seats, clientId);
    await db.query('COMMIT');
    return { outcome: 'success' };
  },

  /** One lock per showtime: everyone queues, then runs the naive code. */
  async advisory_lock(db, { trial, seats, clientId }) {
    await db.query('BEGIN');
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [trial]);
    const rows = await readCheck(db, trial, seats);
    if (rows.length !== seats.length || rows.some((r) => r.status !== 'AVAILABLE')) {
      await db.query('ROLLBACK');
      return conflict();
    }
    await db.query(
      `UPDATE ${SCHEMA}.show_seats SET status = 'HELD', held_by = $3, version = version + 1
        WHERE trial_id = $1 AND seat_no = ANY($2::int[])`,
      [trial, seats, clientId],
    );
    await claim(db, trial, seats, clientId);
    await db.query('COMMIT');
    return { outcome: 'success' };
  },
};

/** Runs a strategy, classifying failures by SQLSTATE and always leaving the connection clean. */
export async function attempt(name, db, args) {
  try {
    return await strategies[name](db, args);
  } catch (err) {
    try {
      await db.query('ROLLBACK');
    } catch {
      /* connection may already be aborted */
    }
    const code = err?.code;
    return { outcome: CODES[code] ?? 'error', sqlstate: code ?? null, error: String(err?.message ?? err).slice(0, 200) };
  }
}

export const SCHEMA_SQL = `
CREATE SCHEMA IF NOT EXISTS ${SCHEMA};
CREATE TABLE IF NOT EXISTS ${SCHEMA}.show_seats (
  trial_id text NOT NULL,
  seat_no  int  NOT NULL,
  status   text NOT NULL DEFAULT 'AVAILABLE',
  held_by  int,
  version  int  NOT NULL DEFAULT 0,
  PRIMARY KEY (trial_id, seat_no)
);
CREATE TABLE IF NOT EXISTS ${SCHEMA}.claims (
  trial_id   text NOT NULL,
  seat_no    int  NOT NULL,
  client     int  NOT NULL,
  claimed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS claims_trial_idx ON ${SCHEMA}.claims (trial_id);
`;
