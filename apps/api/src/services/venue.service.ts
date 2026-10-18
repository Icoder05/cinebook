import { and, eq, gt, inArray, sql } from 'drizzle-orm';
import type { ScreenInput, ScreenLayout, ShowtimeInput } from '@cinebook/shared';
import { db, type Executor } from '../db/client.js';
import { movies, screens, seats, seatTiers, showtimes } from '../db/schema.js';
import { clearCache } from '../lib/cache.js';
import { AppError, conflict, notFound, PG, pgCode } from '../lib/errors.js';
import { addDays, istAt, istDate } from '../lib/time.js';

function rowLabel(index: number): string {
  // 0 → A … 25 → Z, 26 → AA
  return index < 26 ? String.fromCharCode(65 + index) : 'A' + String.fromCharCode(65 + index - 26);
}

/**
 * Builds tiers + seats from a compact spec. Tiers are given back-of-hall first;
 * rows are lettered from the front, so the frontmost row is A.
 */
export async function createScreen(ex: Executor, spec: ScreenInput) {
  const totalRows = spec.tiers.reduce((n, t) => n + t.rows, 0);
  const layout: ScreenLayout = {
    rows: totalRows,
    cols: spec.cols,
    aisles: [...new Set(spec.aisles)].sort((a, b) => a - b),
    formats: spec.formats,
  };
  const [screen] = await ex
    .insert(screens)
    .values({ theatreId: spec.theatreId, name: spec.name, layout })
    .returning();

  const tierRows = await ex
    .insert(seatTiers)
    .values(
      spec.tiers.map((t, i) => ({
        screenId: screen.id,
        name: t.name,
        basePricePaise: t.pricePaise,
        sortOrder: i,
      })),
    )
    .returning();

  const blocked = new Set(spec.blocked);
  const seatValues: (typeof seats.$inferInsert)[] = [];
  let rowFromBack = 0;
  spec.tiers.forEach((t, ti) => {
    for (let r = 0; r < t.rows; r++, rowFromBack++) {
      const label = rowLabel(totalRows - 1 - rowFromBack);
      // In 3+ tier halls the back (recliner) rows are narrower, like real recliners.
      const inset = ti === 0 && spec.tiers.length >= 3 && spec.cols > 10 ? 2 : 0;
      for (let c = 1 + inset; c <= spec.cols - inset; c++) {
        seatValues.push({
          screenId: screen.id,
          rowLabel: label,
          colNo: c,
          tierId: tierRows[ti].id,
          isBlocked: blocked.has(`${label}${c}`),
        });
      }
    }
  });
  await ex.insert(seats).values(seatValues);
  return { ...screen, seatCount: seatValues.length };
}

/** Materialise one show_seats row per bookable seat for the given showtimes. */
export async function generateShowSeats(ex: Executor, showtimeIds: string[]) {
  if (!showtimeIds.length) return;
  await ex.execute(sql`
    INSERT INTO show_seats (showtime_id, seat_id)
    SELECT st.id, s.id
    FROM showtimes st
    JOIN seats s ON s.screen_id = st.screen_id AND NOT s.is_blocked
    WHERE st.id IN (${sql.join(
      showtimeIds.map((id) => sql`${id}::uuid`),
      sql`, `,
    )})
    ON CONFLICT DO NOTHING
  `);
}

export async function createShowtime(input: ShowtimeInput) {
  const [movie] = await db().select().from(movies).where(eq(movies.id, input.movieId)).limit(1);
  if (!movie) throw notFound('Movie');
  const [screen] = await db().select().from(screens).where(eq(screens.id, input.screenId)).limit(1);
  if (!screen) throw notFound('Screen');
  const startsAt = new Date(input.startsAt);
  if (startsAt.getTime() <= Date.now()) {
    throw new AppError(422, 'VALIDATION_ERROR', 'Showtime must be in the future');
  }
  const endsAt = new Date(startsAt.getTime() + (movie.runtimeMin ?? 150) * 60_000);

  try {
    const st = await db().transaction(async (tx) => {
      const [row] = await tx
        .insert(showtimes)
        .values({
          movieId: input.movieId,
          screenId: input.screenId,
          startsAt,
          endsAt,
          language: input.language,
          format: input.format,
          priceOverrides: input.priceOverrides,
        })
        .returning();
      await generateShowSeats(tx, [row.id]);
      return row;
    });
    clearCache();
    return st;
  } catch (err) {
    if (pgCode(err) === PG.exclusionViolation) {
      throw conflict('SHOWTIME_OVERLAP', 'That screen already has a show during this time');
    }
    throw err;
  }
}

/** IST start times for the daily schedule; 3.5 h apart so long films still fit. */
const SLOTS: [number, number][] = [
  [10, 0],
  [13, 30],
  [17, 0],
  [20, 30],
];
const SLOT_GAP_MIN = 210;

/**
 * Fills the next `days` days with showtimes for every screen, rotating through
 * now-showing movies. Idempotent: slots that already have a show are skipped.
 */
export async function autoSchedule(days = 7): Promise<{ created: number }> {
  const nowShowing = await db()
    .select({
      id: movies.id,
      runtimeMin: movies.runtimeMin,
      languages: movies.languages,
    })
    .from(movies)
    .where(eq(movies.status, 'now_showing'))
    .orderBy(sql`${movies.rating} DESC NULLS LAST`, sql`${movies.releaseDate} DESC NULLS LAST`, movies.title);
  const playable = nowShowing.filter((m) => (m.runtimeMin ?? 150) <= SLOT_GAP_MIN - 10);
  if (!playable.length) return { created: 0 };

  const allScreens = await db()
    .select({ id: screens.id, layout: screens.layout, theatreId: screens.theatreId })
    .from(screens)
    .orderBy(screens.theatreId, screens.name);

  const existing = await db()
    .select({ screenId: showtimes.screenId, startsAt: showtimes.startsAt })
    .from(showtimes)
    .where(and(eq(showtimes.status, 'SCHEDULED'), gt(showtimes.startsAt, sql`now() - interval '1 day'`)));
  const taken = new Set(existing.map((e) => `${e.screenId}|${e.startsAt.getTime()}`));

  const now = Date.now();
  const today = istDate(new Date());
  const values: (typeof showtimes.$inferInsert)[] = [];
  const surge: boolean[] = [];

  allScreens.forEach((screen, si) => {
    const formats = screen.layout.formats?.length ? screen.layout.formats : ['2D' as const];
    for (let d = 0; d < days; d++) {
      const date = addDays(today, d);
      const weekend = [0, 6].includes(new Date(`${date}T12:00:00+05:30`).getUTCDay());
      SLOTS.forEach(([h, m], slot) => {
        const startsAt = istAt(date, h, m);
        if (startsAt.getTime() <= now + 30 * 60_000) return;
        if (taken.has(`${screen.id}|${startsAt.getTime()}`)) return;
        const movie = playable[(si * 3 + slot + d) % playable.length];
        const format = formats[(slot + d) % formats.length];
        values.push({
          movieId: movie.id,
          screenId: screen.id,
          startsAt,
          endsAt: new Date(startsAt.getTime() + (movie.runtimeMin ?? 150) * 60_000),
          // Mostly the original language; the late show rotates through dubbed versions.
          language:
            slot === SLOTS.length - 1 && movie.languages.length > 1
              ? movie.languages[1 + (d % (movie.languages.length - 1))]
              : (movie.languages[0] ?? 'English'),
          format,
          priceOverrides: {},
        });
        // Weekend evenings cost ₹50 more per seat (exercises price_overrides).
        surge.push(weekend && slot >= 2);
      });
    }
  });
  if (!values.length) return { created: 0 };

  const surgeScreens = [...new Set(values.filter((_, i) => surge[i]).map((v) => v.screenId))];
  const tiers = surgeScreens.length
    ? await db().select().from(seatTiers).where(inArray(seatTiers.screenId, surgeScreens))
    : [];
  values.forEach((v, i) => {
    if (!surge[i]) return;
    v.priceOverrides = Object.fromEntries(
      tiers.filter((t) => t.screenId === v.screenId).map((t) => [t.id, t.basePricePaise + 5000]),
    );
  });

  let created = 0;
  for (let i = 0; i < values.length; i += 200) {
    const chunk = values.slice(i, i + 200);
    await db().transaction(async (tx) => {
      const rows = await tx.insert(showtimes).values(chunk).onConflictDoNothing().returning({ id: showtimes.id });
      await generateShowSeats(tx, rows.map((r) => r.id));
      created += rows.length;
    });
  }
  clearCache();
  return { created };
}
