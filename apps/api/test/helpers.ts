import { sql } from 'drizzle-orm';
import type { Express } from 'express';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { closeDb, db, initDb } from '../src/db/client.js';
import { dropAll, migrate } from '../src/db/migrate.js';
import { castMembers, cities, movies, theatres } from '../src/db/schema.js';
import { createScreen, generateShowSeats } from '../src/services/venue.service.js';
import { showtimes } from '../src/db/schema.js';

/**
 * Tests run on in-memory PGlite by default (no setup, fully isolated). Set
 * TEST_DATABASE_URL to a throwaway Neon branch to run the same suite — including
 * the 50-way concurrency test — against real, truly concurrent Postgres.
 */
export async function setupTestDb(): Promise<Express> {
  const url = process.env.TEST_DATABASE_URL || 'pglite://memory';
  await initDb(url);
  if (!url.startsWith('pglite://')) await dropAll();
  await migrate(() => {});
  return createApp();
}

export const teardownTestDb = closeDb;

export interface Fixture {
  cityId: string;
  movieId: string;
  screenId: string;
  showtimeId: string;
  seatIds: string[];
  tiers: { id: string; name: string; base_price_paise: number }[];
}

let counter = 0;

/** One city → theatre → 2-tier screen → movie → one showtime starting `hoursAhead` from now. */
export async function createFixture(hoursAhead = 24): Promise<Fixture> {
  const n = ++counter;
  const [city] = await db().insert(cities).values({ name: `Testpur ${n}`, state: 'Test' }).returning();
  const [theatre] = await db()
    .insert(theatres)
    .values({ cityId: city.id, name: `Test Cinema ${n}`, address: '1 Test Rd' })
    .returning();
  const screen = await db().transaction((tx) =>
    createScreen(tx, {
      theatreId: theatre.id,
      name: 'Screen 1',
      cols: 8,
      tiers: [
        { name: 'Prime', pricePaise: 25000, rows: 2 },
        { name: 'Classic', pricePaise: 18000, rows: 2 },
      ],
      aisles: [4],
      blocked: ['A1'],
      formats: ['2D'],
    }),
  );
  const [movie] = await db()
    .insert(movies)
    .values({
      title: `Test Movie ${n}`,
      runtimeMin: 120,
      languages: ['Hindi'],
      genres: ['Drama'],
      status: 'now_showing',
    })
    .returning();
  await db().insert(castMembers).values({ movieId: movie.id, name: 'Lead Actor', orderNo: 0 });
  const startsAt = new Date(Date.now() + hoursAhead * 3600_000);
  const [st] = await db()
    .insert(showtimes)
    .values({
      movieId: movie.id,
      screenId: screen.id,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 120 * 60_000),
      language: 'Hindi',
      format: '2D',
    })
    .returning();
  await generateShowSeats(db(), [st.id]);

  const seatRows = await db().execute<{ seat_id: string }>(sql`
    SELECT ss.seat_id FROM show_seats ss JOIN seats s ON s.id = ss.seat_id
    WHERE ss.showtime_id = ${st.id} ORDER BY s.row_label, s.col_no
  `);
  const tiers = await db().execute<{ id: string; name: string; base_price_paise: number }>(sql`
    SELECT id, name, base_price_paise FROM seat_tiers WHERE screen_id = ${screen.id} ORDER BY sort_order
  `);
  return {
    cityId: city.id,
    movieId: movie.id,
    screenId: screen.id,
    showtimeId: st.id,
    seatIds: seatRows.rows.map((r) => r.seat_id),
    tiers: tiers.rows,
  };
}

export interface TestUser {
  id: string;
  email: string;
  token: string;
  cookie: string;
}

export function refreshCookieFrom(res: request.Response): string {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  const c = raw?.find((h) => h.startsWith('cb_rt='));
  if (!c) throw new Error('no refresh cookie set');
  return c.split(';')[0];
}

export async function signup(app: Express, label = 'user'): Promise<TestUser> {
  const email = `${label}.${++counter}.${Date.now()}@example.com`;
  const res = await request(app)
    .post('/api/v1/auth/signup')
    .send({ name: 'Test User', email, phone: '9876543210', password: 'secret123' })
    .expect(201);
  return { id: res.body.user.id, email, token: res.body.accessToken, cookie: refreshCookieFrom(res) };
}

export const auth = (u: TestUser) => ({ Authorization: `Bearer ${u.token}` });
