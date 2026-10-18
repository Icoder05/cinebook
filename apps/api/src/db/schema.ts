import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  doublePrecision,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import type { ScreenLayout } from '@cinebook/shared';

// Table shapes mirror migrations/0001_init.ts, which is the source of truth for
// constraints Drizzle can't express (exclusion constraint, partial indexes).

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const id = () =>
  uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`);

export const users = pgTable('users', {
  id: id(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  phone: text('phone'),
  passwordHash: text('password_hash').notNull(),
  role: text('role').$type<'customer' | 'admin'>().notNull().default('customer'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const sessions = pgTable('sessions', {
  id: id(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  refreshTokenHash: text('refresh_token_hash').notNull().unique(),
  familyId: uuid('family_id').notNull(),
  userAgent: text('user_agent'),
  ip: text('ip'),
  expiresAt: ts('expires_at').notNull(),
  revokedAt: ts('revoked_at'),
  revokedReason: text('revoked_reason'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const movies = pgTable('movies', {
  id: id(),
  tmdbId: integer('tmdb_id').unique(),
  title: text('title').notNull(),
  overview: text('overview'),
  posterPath: text('poster_path'),
  backdropPath: text('backdrop_path'),
  runtimeMin: integer('runtime_min'),
  releaseDate: date('release_date', { mode: 'string' }),
  languages: text('languages').array().notNull().default(sql`'{}'::text[]`),
  genres: text('genres').array().notNull().default(sql`'{}'::text[]`),
  certificate: text('certificate'),
  rating: real('rating'),
  trailerKey: text('trailer_key'),
  status: text('status').$type<'now_showing' | 'upcoming'>().notNull(),
  syncedAt: ts('synced_at'),
});

export const castMembers = pgTable('cast_members', {
  id: id(),
  movieId: uuid('movie_id')
    .notNull()
    .references(() => movies.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  character: text('character'),
  profilePath: text('profile_path'),
  orderNo: integer('order_no').notNull(),
});

export const cities = pgTable('cities', {
  id: id(),
  name: text('name').notNull().unique(),
  state: text('state').notNull(),
});

export const theatres = pgTable('theatres', {
  id: id(),
  cityId: uuid('city_id')
    .notNull()
    .references(() => cities.id),
  name: text('name').notNull(),
  address: text('address').notNull(),
  lat: doublePrecision('lat'),
  lng: doublePrecision('lng'),
  amenities: text('amenities').array().notNull().default(sql`'{}'::text[]`),
});

export const screens = pgTable('screens', {
  id: id(),
  theatreId: uuid('theatre_id')
    .notNull()
    .references(() => theatres.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  layout: jsonb('layout').$type<ScreenLayout>().notNull(),
});

export const seatTiers = pgTable('seat_tiers', {
  id: id(),
  screenId: uuid('screen_id')
    .notNull()
    .references(() => screens.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  basePricePaise: integer('base_price_paise').notNull(),
  sortOrder: integer('sort_order').notNull(),
});

export const seats = pgTable('seats', {
  id: id(),
  screenId: uuid('screen_id')
    .notNull()
    .references(() => screens.id, { onDelete: 'cascade' }),
  rowLabel: text('row_label').notNull(),
  colNo: integer('col_no').notNull(),
  tierId: uuid('tier_id')
    .notNull()
    .references(() => seatTiers.id),
  isBlocked: boolean('is_blocked').notNull().default(false),
});

export type ShowtimeFormat = '2D' | '3D' | 'IMAX' | '4DX';

export const showtimes = pgTable('showtimes', {
  id: id(),
  movieId: uuid('movie_id')
    .notNull()
    .references(() => movies.id),
  screenId: uuid('screen_id')
    .notNull()
    .references(() => screens.id),
  startsAt: ts('starts_at').notNull(),
  endsAt: ts('ends_at').notNull(),
  language: text('language').notNull(),
  format: text('format').$type<ShowtimeFormat>().notNull(),
  priceOverrides: jsonb('price_overrides').$type<Record<string, number>>().notNull().default({}),
  status: text('status').$type<'SCHEDULED' | 'CANCELLED'>().notNull().default('SCHEDULED'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export type BookingStatusCol = 'PENDING' | 'CONFIRMED' | 'FAILED' | 'EXPIRED' | 'CANCELLED';

export const bookings = pgTable('bookings', {
  id: id(),
  code: text('code').notNull().unique(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  showtimeId: uuid('showtime_id')
    .notNull()
    .references(() => showtimes.id),
  status: text('status').$type<BookingStatusCol>().notNull(),
  seatCount: integer('seat_count').notNull(),
  subtotalPaise: integer('subtotal_paise').notNull(),
  feePaise: integer('fee_paise').notNull(),
  taxPaise: integer('tax_paise').notNull(),
  totalPaise: integer('total_paise').notNull(),
  holdExpiresAt: ts('hold_expires_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
  confirmedAt: ts('confirmed_at'),
  cancelledAt: ts('cancelled_at'),
});

export const showSeats = pgTable(
  'show_seats',
  {
    showtimeId: uuid('showtime_id')
      .notNull()
      .references(() => showtimes.id, { onDelete: 'cascade' }),
    seatId: uuid('seat_id')
      .notNull()
      .references(() => seats.id),
    status: text('status').$type<'AVAILABLE' | 'HELD' | 'BOOKED'>().notNull().default('AVAILABLE'),
    heldBy: uuid('held_by').references(() => users.id),
    holdId: uuid('hold_id'),
    holdExpiresAt: ts('hold_expires_at'),
    bookingId: uuid('booking_id').references(() => bookings.id),
    version: integer('version').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.showtimeId, t.seatId] })],
);

export const bookingSeats = pgTable(
  'booking_seats',
  {
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => bookings.id, { onDelete: 'cascade' }),
    seatId: uuid('seat_id')
      .notNull()
      .references(() => seats.id),
    seatLabel: text('seat_label').notNull(),
    tierName: text('tier_name').notNull(),
    pricePaise: integer('price_paise').notNull(),
  },
  (t) => [primaryKey({ columns: [t.bookingId, t.seatId] })],
);

export type PaymentStatusCol = 'INITIATED' | 'SUCCESS' | 'FAILED' | 'REFUNDED';

export const payments = pgTable('payments', {
  id: id(),
  bookingId: uuid('booking_id')
    .notNull()
    .references(() => bookings.id),
  idempotencyKey: text('idempotency_key').notNull().unique(),
  method: text('method').$type<'card' | 'upi' | 'netbanking'>().notNull(),
  instrument: text('instrument'),
  status: text('status').$type<PaymentStatusCol>().notNull(),
  amountPaise: integer('amount_paise').notNull(),
  fakeTxnRef: text('fake_txn_ref'),
  failureReason: text('failure_reason'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});
