import { asc, eq, sql, type SQL } from 'drizzle-orm';
import {
  type City,
  type MovieDetail,
  type MoviesQuery,
  type MovieShowtimesResponse,
  type MovieSummary,
  type SeatMapResponse,
  resolveTierPrice,
} from '@cinebook/shared';
import { db } from '../db/client.js';
import { castMembers, cities, movies } from '../db/schema.js';
import { cached } from '../lib/cache.js';
import { notFound } from '../lib/errors.js';
import { addDays, istDate, istDayBounds } from '../lib/time.js';

type MovieRow = typeof movies.$inferSelect;

function toSummary(m: MovieRow): MovieSummary {
  return {
    id: m.id,
    title: m.title,
    posterPath: m.posterPath,
    backdropPath: m.backdropPath,
    languages: m.languages,
    genres: m.genres,
    certificate: m.certificate,
    rating: m.rating === null ? null : Math.round(m.rating * 10) / 10,
    releaseDate: m.releaseDate,
    runtimeMin: m.runtimeMin,
    status: m.status,
  };
}

export async function listCities(): Promise<City[]> {
  return cached('cities', () =>
    db().select({ id: cities.id, name: cities.name, state: cities.state }).from(cities).orderBy(asc(cities.name)),
  );
}

/** Live showtimes of movie `m` (optionally in a city / format). */
function liveShowtimeExists(cityId?: string, format?: string): SQL {
  return sql`EXISTS (
    SELECT 1 FROM showtimes st
    JOIN screens sc ON sc.id = st.screen_id
    JOIN theatres t ON t.id = sc.theatre_id
    WHERE st.movie_id = ${movies.id}
      AND st.status = 'SCHEDULED'
      AND st.starts_at > now()
      ${cityId ? sql`AND t.city_id = ${cityId}` : sql``}
      ${format ? sql`AND st.format = ${format}` : sql``}
  )`;
}

export async function listMovies(q: MoviesQuery): Promise<{ movies: MovieSummary[] }> {
  return cached(`movies:${JSON.stringify(q)}`, async () => {
    const where: SQL[] = [];
    if (q.status) where.push(sql`${movies.status} = ${q.status}`);
    if (q.lang) where.push(sql`${q.lang} = ANY(${movies.languages})`);
    if (q.genre) where.push(sql`${q.genre} = ANY(${movies.genres})`);
    if (q.q) {
      const escaped = q.q.replace(/[\\%_]/g, (c) => `\\${c}`);
      where.push(sql`${movies.title} ILIKE ${`%${escaped}%`}`);
    }
    if (q.city || q.format) where.push(liveShowtimeExists(q.city, q.format));

    const rows = await db()
      .select()
      .from(movies)
      .where(where.length ? sql.join(where, sql` AND `) : undefined)
      .orderBy(
        sql`${movies.status} = 'now_showing' DESC`,
        sql`CASE WHEN ${movies.status} = 'upcoming' THEN ${movies.releaseDate} END ASC NULLS LAST`,
        sql`${movies.rating} DESC NULLS LAST`,
        sql`${movies.releaseDate} DESC NULLS LAST`,
        asc(movies.title),
      )
      .limit(q.limit);
    return { movies: rows.map(toSummary) };
  });
}

export async function getMovie(id: string): Promise<{ movie: MovieDetail }> {
  return cached(`movie:${id}`, async () => {
    const [m] = await db().select().from(movies).where(eq(movies.id, id)).limit(1);
    if (!m) throw notFound('Movie');
    const cast = await db()
      .select({
        name: castMembers.name,
        character: castMembers.character,
        profilePath: castMembers.profilePath,
      })
      .from(castMembers)
      .where(eq(castMembers.movieId, id))
      .orderBy(asc(castMembers.orderNo))
      .limit(10);
    return {
      movie: { ...toSummary(m), overview: m.overview, trailerKey: m.trailerKey, cast },
    };
  });
}

export async function getMovieShowtimes(
  movieId: string,
  cityId: string,
  date: string | undefined,
): Promise<MovieShowtimesResponse> {
  const [m] = await db().select().from(movies).where(eq(movies.id, movieId)).limit(1);
  if (!m) throw notFound('Movie');

  const today = istDate(new Date());
  const window = Array.from({ length: 7 }, (_, i) => addDays(today, i));

  // Which of the next 7 days have shows in this city?
  const { start: windowStart } = istDayBounds(today);
  const { end: windowEnd } = istDayBounds(window[6]);
  const upcoming = await db().execute<{ starts_at: string | Date }>(sql`
    SELECT st.starts_at
    FROM showtimes st
    JOIN screens sc ON sc.id = st.screen_id
    JOIN theatres t ON t.id = sc.theatre_id
    WHERE st.movie_id = ${movieId} AND t.city_id = ${cityId}
      AND st.status = 'SCHEDULED'
      AND st.starts_at > now()
      AND st.starts_at >= ${windowStart.toISOString()} AND st.starts_at < ${windowEnd.toISOString()}
  `);
  const daysWithShows = new Set(upcoming.rows.map((r) => istDate(new Date(r.starts_at))));
  const dates = window.map((d) => ({ date: d, hasShows: daysWithShows.has(d) }));
  const selected =
    date && window.includes(date) ? date : (dates.find((d) => d.hasShows)?.date ?? today);

  const { start, end } = istDayBounds(selected);
  const res = await db().execute<{
    id: string;
    starts_at: string | Date;
    format: MovieShowtimesResponse['theatres'][number]['showtimes'][number]['format'];
    language: string;
    screen_name: string;
    theatre_id: string;
    theatre_name: string;
    address: string;
    amenities: string[];
    available: number;
    total: number;
  }>(sql`
    SELECT st.id, st.starts_at, st.format, st.language, sc.name AS screen_name,
           t.id AS theatre_id, t.name AS theatre_name, t.address, t.amenities,
           COALESCE(a.available, 0)::int AS available, COALESCE(a.total, 0)::int AS total
    FROM showtimes st
    JOIN screens sc ON sc.id = st.screen_id
    JOIN theatres t ON t.id = sc.theatre_id
    LEFT JOIN LATERAL (
      SELECT count(*) AS total,
             count(*) FILTER (WHERE ss.status = 'AVAILABLE'
                               OR (ss.status = 'HELD' AND ss.hold_expires_at < now())) AS available
      FROM show_seats ss WHERE ss.showtime_id = st.id
    ) a ON true
    WHERE st.movie_id = ${movieId} AND t.city_id = ${cityId}
      AND st.status = 'SCHEDULED'
      AND st.starts_at > now()
      AND st.starts_at >= ${start.toISOString()} AND st.starts_at < ${end.toISOString()}
    ORDER BY t.name, st.starts_at
  `);

  const theatres = new Map<string, MovieShowtimesResponse['theatres'][number]>();
  for (const r of res.rows) {
    let t = theatres.get(r.theatre_id);
    if (!t) {
      t = { id: r.theatre_id, name: r.theatre_name, address: r.address, amenities: r.amenities, showtimes: [] };
      theatres.set(r.theatre_id, t);
    }
    const ratio = r.total ? r.available / r.total : 0;
    t.showtimes.push({
      id: r.id,
      startsAt: new Date(r.starts_at).toISOString(),
      format: r.format,
      language: r.language,
      screenName: r.screen_name,
      available: r.available,
      total: r.total,
      availability: r.available === 0 ? 'SOLD_OUT' : ratio < 0.25 ? 'FILLING_FAST' : 'AVAILABLE',
    });
  }

  return {
    movie: {
      id: m.id,
      title: m.title,
      certificate: m.certificate,
      genres: m.genres,
      languages: m.languages,
      runtimeMin: m.runtimeMin,
    },
    date: selected,
    dates,
    theatres: [...theatres.values()],
  };
}

/** Never cached: this is the screen users stare at while seats change. */
export async function getSeatMap(showtimeId: string, viewerId: string | null): Promise<SeatMapResponse> {
  const head = await db().execute<{
    id: string;
    starts_at: string | Date;
    format: SeatMapResponse['showtime']['format'];
    language: string;
    status: string;
    price_overrides: Record<string, number>;
    movie_id: string;
    title: string;
    certificate: string | null;
    theatre_id: string;
    theatre_name: string;
    address: string;
    city: string;
    screen_id: string;
    screen_name: string;
    layout: SeatMapResponse['screen']['layout'];
  }>(sql`
    SELECT st.id, st.starts_at, st.format, st.language, st.status, st.price_overrides,
           m.id AS movie_id, m.title, m.certificate,
           t.id AS theatre_id, t.name AS theatre_name, t.address, c.name AS city,
           sc.id AS screen_id, sc.name AS screen_name, sc.layout
    FROM showtimes st
    JOIN movies m ON m.id = st.movie_id
    JOIN screens sc ON sc.id = st.screen_id
    JOIN theatres t ON t.id = sc.theatre_id
    JOIN cities c ON c.id = t.city_id
    WHERE st.id = ${showtimeId}
  `);
  const h = head.rows[0];
  if (!h) throw notFound('Showtime');

  const [tiers, seatRows, hold] = await Promise.all([
    db().execute<{ id: string; name: string; base_price_paise: number; sort_order: number }>(sql`
      SELECT id, name, base_price_paise, sort_order FROM seat_tiers
      WHERE screen_id = ${h.screen_id} ORDER BY sort_order
    `),
    db().execute<{ id: string; row: string; col: number; tier_id: string; state: SeatMapResponse['seats'][number]['state'] }>(sql`
      SELECT s.id, s.row_label AS row, s.col_no AS col, s.tier_id,
        CASE
          WHEN s.is_blocked OR ss.seat_id IS NULL THEN 'BLOCKED'
          WHEN ss.status = 'BOOKED' THEN 'BOOKED'
          WHEN ss.status = 'HELD' AND ss.hold_expires_at > now() THEN
            CASE WHEN ss.held_by = ${viewerId}::uuid THEN 'HELD_BY_ME' ELSE 'HELD' END
          ELSE 'AVAILABLE'
        END AS state
      FROM seats s
      LEFT JOIN show_seats ss ON ss.seat_id = s.id AND ss.showtime_id = ${showtimeId}
      WHERE s.screen_id = ${h.screen_id}
      ORDER BY length(s.row_label) DESC, s.row_label DESC, s.col_no
    `),
    viewerId
      ? db().execute<{ id: string; hold_expires_at: string | Date }>(sql`
          SELECT id, hold_expires_at FROM bookings
          WHERE user_id = ${viewerId} AND showtime_id = ${showtimeId}
            AND status = 'PENDING' AND hold_expires_at > now()
          ORDER BY created_at DESC LIMIT 1
        `)
      : Promise.resolve({ rows: [] as { id: string; hold_expires_at: string | Date }[] }),
  ]);

  const startsAt = new Date(h.starts_at);
  const myHold = hold.rows[0];
  return {
    showtime: {
      id: h.id,
      startsAt: startsAt.toISOString(),
      format: h.format,
      language: h.language,
      bookable: h.status === 'SCHEDULED' && startsAt.getTime() > Date.now(),
    },
    movie: { id: h.movie_id, title: h.title, certificate: h.certificate },
    theatre: { id: h.theatre_id, name: h.theatre_name, address: h.address, city: h.city },
    screen: { id: h.screen_id, name: h.screen_name, layout: h.layout },
    tiers: tiers.rows.map((t) => ({
      id: t.id,
      name: t.name,
      pricePaise: resolveTierPrice(t.id, t.base_price_paise, h.price_overrides),
      sortOrder: t.sort_order,
    })),
    seats: seatRows.rows.map((s) => ({ id: s.id, row: s.row, col: s.col, tierId: s.tier_id, state: s.state })),
    myHold: myHold
      ? { bookingId: myHold.id, holdExpiresAt: new Date(myHold.hold_expires_at).toISOString() }
      : null,
  };
}
