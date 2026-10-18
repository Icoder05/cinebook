// Hand-written SQL: Drizzle Kit can't express the showtime exclusion constraint or
// the partial indexes below, and these are exactly the parts the design relies on.
export default /* sql */ `
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  email         text NOT NULL UNIQUE,
  phone         text,
  password_hash text NOT NULL,
  role          text NOT NULL DEFAULT 'customer' CHECK (role IN ('customer', 'admin')),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_token_hash text NOT NULL UNIQUE,
  family_id          uuid NOT NULL,
  user_agent         text,
  ip                 text,
  expires_at         timestamptz NOT NULL,
  revoked_at         timestamptz,
  revoked_reason     text,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx ON sessions (user_id) WHERE revoked_at IS NULL;

CREATE TABLE movies (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tmdb_id       integer UNIQUE,
  title         text NOT NULL,
  overview      text,
  poster_path   text,
  backdrop_path text,
  runtime_min   integer,
  release_date  date,
  languages     text[] NOT NULL DEFAULT '{}',
  genres        text[] NOT NULL DEFAULT '{}',
  certificate   text,
  rating        real,
  trailer_key   text,
  status        text NOT NULL CHECK (status IN ('now_showing', 'upcoming')),
  synced_at     timestamptz
);
CREATE INDEX movies_status_idx ON movies (status);
CREATE INDEX movies_title_trgm_idx ON movies USING gin (title gin_trgm_ops);

CREATE TABLE cast_members (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  movie_id     uuid NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
  name         text NOT NULL,
  character    text,
  profile_path text,
  order_no     integer NOT NULL
);
CREATE INDEX cast_members_movie_idx ON cast_members (movie_id, order_no);

CREATE TABLE cities (
  id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name  text NOT NULL UNIQUE,
  state text NOT NULL
);

CREATE TABLE theatres (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city_id   uuid NOT NULL REFERENCES cities(id),
  name      text NOT NULL,
  address   text NOT NULL,
  lat       double precision,
  lng       double precision,
  amenities text[] NOT NULL DEFAULT '{}'
);
CREATE INDEX theatres_city_idx ON theatres (city_id);

CREATE TABLE screens (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  theatre_id uuid NOT NULL REFERENCES theatres(id) ON DELETE CASCADE,
  name       text NOT NULL,
  layout     jsonb NOT NULL
);
CREATE INDEX screens_theatre_idx ON screens (theatre_id);

CREATE TABLE seat_tiers (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  screen_id        uuid NOT NULL REFERENCES screens(id) ON DELETE CASCADE,
  name             text NOT NULL,
  base_price_paise integer NOT NULL CHECK (base_price_paise >= 0),
  sort_order       integer NOT NULL
);
CREATE INDEX seat_tiers_screen_idx ON seat_tiers (screen_id);

CREATE TABLE seats (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  screen_id  uuid NOT NULL REFERENCES screens(id) ON DELETE CASCADE,
  row_label  text NOT NULL,
  col_no     integer NOT NULL,
  tier_id    uuid NOT NULL REFERENCES seat_tiers(id),
  is_blocked boolean NOT NULL DEFAULT false,
  UNIQUE (screen_id, row_label, col_no)
);

CREATE TABLE showtimes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  movie_id        uuid NOT NULL REFERENCES movies(id),
  screen_id       uuid NOT NULL REFERENCES screens(id),
  starts_at       timestamptz NOT NULL,
  ends_at         timestamptz NOT NULL,
  language        text NOT NULL,
  format          text NOT NULL CHECK (format IN ('2D', '3D', 'IMAX', '4DX')),
  price_overrides jsonb NOT NULL DEFAULT '{}',
  status          text NOT NULL DEFAULT 'SCHEDULED' CHECK (status IN ('SCHEDULED', 'CANCELLED')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  -- A screen can never run two overlapping shows.
  CONSTRAINT showtimes_no_overlap EXCLUDE USING gist (
    screen_id WITH =,
    tstzrange(starts_at, ends_at) WITH &&
  ) WHERE (status = 'SCHEDULED')
);
CREATE INDEX showtimes_movie_starts_idx ON showtimes (movie_id, starts_at);
CREATE INDEX showtimes_screen_idx ON showtimes (screen_id);

CREATE TABLE bookings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code            text NOT NULL UNIQUE,
  user_id         uuid NOT NULL REFERENCES users(id),
  showtime_id     uuid NOT NULL REFERENCES showtimes(id),
  status          text NOT NULL CHECK (status IN ('PENDING', 'CONFIRMED', 'FAILED', 'EXPIRED', 'CANCELLED')),
  seat_count      integer NOT NULL CHECK (seat_count BETWEEN 1 AND 10),
  subtotal_paise  integer NOT NULL,
  fee_paise       integer NOT NULL,
  tax_paise       integer NOT NULL,
  total_paise     integer NOT NULL,
  hold_expires_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  confirmed_at    timestamptz,
  cancelled_at    timestamptz
);
CREATE INDEX bookings_user_created_idx ON bookings (user_id, created_at DESC);
CREATE INDEX bookings_showtime_idx ON bookings (showtime_id);
CREATE INDEX bookings_pending_idx ON bookings (hold_expires_at) WHERE status = 'PENDING';

-- The heart of the design: one row per seat per showtime. A seat changes state
-- only through a single conditional UPDATE on this table.
CREATE TABLE show_seats (
  showtime_id     uuid NOT NULL REFERENCES showtimes(id) ON DELETE CASCADE,
  seat_id         uuid NOT NULL REFERENCES seats(id),
  status          text NOT NULL DEFAULT 'AVAILABLE' CHECK (status IN ('AVAILABLE', 'HELD', 'BOOKED')),
  held_by         uuid REFERENCES users(id),
  hold_id         uuid,
  hold_expires_at timestamptz,
  booking_id      uuid REFERENCES bookings(id),
  version         integer NOT NULL DEFAULT 0,
  PRIMARY KEY (showtime_id, seat_id)
);
CREATE INDEX show_seats_hold_expiry_idx ON show_seats (hold_expires_at) WHERE status = 'HELD';
CREATE INDEX show_seats_hold_id_idx ON show_seats (hold_id) WHERE hold_id IS NOT NULL;
CREATE INDEX show_seats_booking_idx ON show_seats (booking_id) WHERE booking_id IS NOT NULL;

CREATE TABLE booking_seats (
  booking_id  uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  seat_id     uuid NOT NULL REFERENCES seats(id),
  seat_label  text NOT NULL,
  tier_name   text NOT NULL,
  price_paise integer NOT NULL,
  PRIMARY KEY (booking_id, seat_id)
);

CREATE TABLE payments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id      uuid NOT NULL REFERENCES bookings(id),
  idempotency_key text NOT NULL UNIQUE,
  method          text NOT NULL CHECK (method IN ('card', 'upi', 'netbanking')),
  instrument      text,
  status          text NOT NULL CHECK (status IN ('INITIATED', 'SUCCESS', 'FAILED', 'REFUNDED')),
  amount_paise    integer NOT NULL,
  fake_txn_ref    text,
  failure_reason  text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
-- At most one in-flight or successful payment per booking, whatever the key.
CREATE UNIQUE INDEX payments_one_live_per_booking ON payments (booking_id)
  WHERE status IN ('INITIATED', 'SUCCESS');
`;
