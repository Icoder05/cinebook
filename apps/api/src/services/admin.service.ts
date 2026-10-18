import { and, eq, sql, type SQL } from 'drizzle-orm';
import type { TheatreInput } from '@cinebook/shared';
import { db } from '../db/client.js';
import { screens, showtimes, theatres } from '../db/schema.js';
import { clearCache } from '../lib/cache.js';
import { conflict, notFound, PG, pgCode } from '../lib/errors.js';
import { addDays, istDate, istDayBounds } from '../lib/time.js';

function inUse(err: unknown, what: string): never {
  if (pgCode(err) === PG.foreignKeyViolation) {
    throw conflict('IN_USE', `This ${what} has showtimes or bookings and can't be deleted`);
  }
  throw err;
}

// --- Theatres --------------------------------------------------------------

export async function listTheatres() {
  const res = await db().execute(sql`
    SELECT t.id, t.name, t.address, t.lat, t.lng, t.amenities, t.city_id AS "cityId", c.name AS city,
           (SELECT count(*)::int FROM screens s WHERE s.theatre_id = t.id) AS "screenCount"
    FROM theatres t JOIN cities c ON c.id = t.city_id
    ORDER BY c.name, t.name
  `);
  return res.rows;
}

export async function createTheatre(input: TheatreInput) {
  const [t] = await db().insert(theatres).values(input).returning();
  clearCache();
  return t;
}

export async function updateTheatre(id: string, input: Partial<TheatreInput>) {
  const [t] = await db().update(theatres).set(input).where(eq(theatres.id, id)).returning();
  if (!t) throw notFound('Theatre');
  clearCache();
  return t;
}

export async function deleteTheatre(id: string) {
  try {
    const r = await db().delete(theatres).where(eq(theatres.id, id)).returning({ id: theatres.id });
    if (!r.length) throw notFound('Theatre');
    clearCache();
  } catch (err) {
    inUse(err, 'theatre');
  }
}

// --- Screens ---------------------------------------------------------------

export async function listScreens(theatreId?: string) {
  const res = await db().execute(sql`
    SELECT s.id, s.name, s.layout, s.theatre_id AS "theatreId", t.name AS theatre, c.name AS city,
           (SELECT count(*)::int FROM seats x WHERE x.screen_id = s.id AND NOT x.is_blocked) AS "seatCount",
           COALESCE((
             SELECT json_agg(json_build_object('id', st.id, 'name', st.name, 'pricePaise', st.base_price_paise) ORDER BY st.sort_order)
             FROM seat_tiers st WHERE st.screen_id = s.id
           ), '[]'::json) AS tiers
    FROM screens s JOIN theatres t ON t.id = s.theatre_id JOIN cities c ON c.id = t.city_id
    ${theatreId ? sql`WHERE s.theatre_id = ${theatreId}` : sql``}
    ORDER BY c.name, t.name, s.name
  `);
  return res.rows;
}

export async function deleteScreen(id: string) {
  try {
    const r = await db().delete(screens).where(eq(screens.id, id)).returning({ id: screens.id });
    if (!r.length) throw notFound('Screen');
  } catch (err) {
    inUse(err, 'screen');
  }
}

// --- Showtimes -------------------------------------------------------------

export async function listShowtimes(q: { date?: string; theatreId?: string; movieId?: string }) {
  const date = q.date ?? istDate(new Date());
  const { start, end } = istDayBounds(date);
  const where: SQL[] = [sql`st.starts_at >= ${start.toISOString()}`, sql`st.starts_at < ${end.toISOString()}`];
  if (q.theatreId) where.push(sql`t.id = ${q.theatreId}`);
  if (q.movieId) where.push(sql`st.movie_id = ${q.movieId}`);
  const res = await db().execute(sql`
    SELECT st.id, st.starts_at AS "startsAt", st.ends_at AS "endsAt", st.format, st.language, st.status,
           m.title AS movie, s.name AS screen, t.name AS theatre, c.name AS city,
           (SELECT count(*)::int FROM show_seats ss WHERE ss.showtime_id = st.id AND ss.status = 'BOOKED') AS booked,
           (SELECT count(*)::int FROM show_seats ss WHERE ss.showtime_id = st.id) AS capacity
    FROM showtimes st
    JOIN movies m ON m.id = st.movie_id
    JOIN screens s ON s.id = st.screen_id
    JOIN theatres t ON t.id = s.theatre_id
    JOIN cities c ON c.id = t.city_id
    WHERE ${sql.join(where, sql` AND `)}
    ORDER BY c.name, t.name, s.name, st.starts_at
    LIMIT 500
  `);
  return { date, showtimes: res.rows };
}

export async function cancelShowtime(id: string) {
  const live = await db().execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM bookings WHERE showtime_id = ${id} AND status IN ('CONFIRMED', 'PENDING')
  `);
  if (live.rows[0].n > 0) {
    throw conflict('HAS_BOOKINGS', 'This show has active bookings; it cannot be cancelled here');
  }
  const r = await db()
    .update(showtimes)
    .set({ status: 'CANCELLED' })
    .where(and(eq(showtimes.id, id), eq(showtimes.status, 'SCHEDULED')))
    .returning({ id: showtimes.id });
  if (!r.length) throw notFound('Scheduled showtime');
  clearCache();
}

// --- Bookings & revenue ----------------------------------------------------

const PAGE_SIZE = 50;

export async function listAllBookings(q: { status?: string; date?: string; q?: string; page: number }) {
  const where: SQL[] = [sql`true`];
  if (q.status) where.push(sql`b.status = ${q.status}`);
  if (q.date) {
    const { start, end } = istDayBounds(q.date);
    where.push(sql`b.created_at >= ${start.toISOString()} AND b.created_at < ${end.toISOString()}`);
  }
  if (q.q) {
    const like = `%${q.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    where.push(sql`(b.code ILIKE ${like} OR u.email ILIKE ${like} OR m.title ILIKE ${like})`);
  }
  const res = await db().execute(sql`
    SELECT b.id, b.code, b.status, b.seat_count AS "seatCount", b.total_paise AS "totalPaise",
           b.created_at AS "createdAt", u.email, u.name AS "userName",
           m.title AS movie, st.starts_at AS "startsAt", t.name AS theatre, c.name AS city,
           count(*) OVER()::int AS "totalCount"
    FROM bookings b
    JOIN users u ON u.id = b.user_id
    JOIN showtimes st ON st.id = b.showtime_id
    JOIN movies m ON m.id = st.movie_id
    JOIN screens s ON s.id = st.screen_id
    JOIN theatres t ON t.id = s.theatre_id
    JOIN cities c ON c.id = t.city_id
    WHERE ${sql.join(where, sql` AND `)}
    ORDER BY b.created_at DESC
    LIMIT ${PAGE_SIZE} OFFSET ${(q.page - 1) * PAGE_SIZE}
  `);
  const rows = res.rows as Record<string, unknown>[];
  const total = (rows[0]?.totalCount as number | undefined) ?? 0;
  return {
    bookings: rows.map(({ totalCount: _t, ...r }) => r),
    page: q.page,
    pageSize: PAGE_SIZE,
    total,
  };
}

/** ADM-2: today's revenue plus a 7-day trend (confirmed bookings, by IST confirmation date). */
export async function stats() {
  const today = istDate(new Date());
  const from = istDayBounds(addDays(today, -6)).start;
  const res = await db().execute<{ day: string; revenue: number; bookings: number; seats: number }>(sql`
    SELECT to_char((confirmed_at AT TIME ZONE 'UTC') + interval '330 minutes', 'YYYY-MM-DD') AS day,
           sum(total_paise)::int AS revenue, count(*)::int AS bookings, sum(seat_count)::int AS seats
    FROM bookings
    WHERE status = 'CONFIRMED' AND confirmed_at >= ${from.toISOString()}
    GROUP BY 1
  `);
  const byDay = new Map(res.rows.map((r) => [r.day, r]));
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6)).map((day) => ({
    date: day,
    revenuePaise: byDay.get(day)?.revenue ?? 0,
    bookings: byDay.get(day)?.bookings ?? 0,
    seats: byDay.get(day)?.seats ?? 0,
  }));
  const counts = await db().execute<{ movies: number; theatres: number; screens: number; upcoming: number }>(sql`
    SELECT (SELECT count(*)::int FROM movies) AS movies,
           (SELECT count(*)::int FROM theatres) AS theatres,
           (SELECT count(*)::int FROM screens) AS screens,
           (SELECT count(*)::int FROM showtimes WHERE status = 'SCHEDULED' AND starts_at > now()) AS upcoming
  `);
  return { today: days[6], last7Days: days, inventory: counts.rows[0] };
}
