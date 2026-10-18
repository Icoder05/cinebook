import { sql } from 'drizzle-orm';
import type { ScreenInput } from '@cinebook/shared';
import { env } from '../env.js';
import { ensureAdmin } from '../services/auth.service.js';
import { syncMoviesFromTmdb } from '../services/tmdb.service.js';
import { autoSchedule, createScreen } from '../services/venue.service.js';
import { db } from './client.js';
import { SNAPSHOT_MOVIES } from './catalog-snapshot.js';
import { castMembers, cities, movies, theatres } from './schema.js';

type ScreenTemplate = Omit<ScreenInput, 'theatreId' | 'name'>;

const BIG: ScreenTemplate = {
  cols: 16,
  tiers: [
    { name: 'Recliner', pricePaise: 45000, rows: 2 },
    { name: 'Prime', pricePaise: 25000, rows: 6 },
    { name: 'Classic', pricePaise: 18000, rows: 4 },
  ],
  aisles: [4, 12],
  blocked: ['A1', 'A16'],
  formats: ['2D', '3D'],
};

const IMAX: ScreenTemplate = {
  cols: 18,
  tiers: [
    { name: 'Recliner', pricePaise: 55000, rows: 2 },
    { name: 'Prime', pricePaise: 35000, rows: 7 },
    { name: 'Classic', pricePaise: 24000, rows: 3 },
  ],
  aisles: [5, 13],
  blocked: [],
  formats: ['IMAX', '2D'],
};

const SMALL: ScreenTemplate = {
  cols: 12,
  tiers: [
    { name: 'Prime', pricePaise: 22000, rows: 6 },
    { name: 'Classic', pricePaise: 15000, rows: 4 },
  ],
  aisles: [6],
  blocked: ['A1', 'A12'],
  formats: ['2D'],
};

const VENUES: {
  city: string;
  state: string;
  theatres: { name: string; address: string; lat: number; lng: number; amenities: string[]; screens: [string, ScreenTemplate][] }[];
}[] = [
  {
    city: 'Bengaluru',
    state: 'Karnataka',
    theatres: [
      {
        name: 'CineBook Orion Mall',
        address: 'Orion Mall, Dr Rajkumar Rd, Rajajinagar',
        lat: 13.0108,
        lng: 77.5552,
        amenities: ['Parking', 'Food Court', 'Wheelchair Access', 'M-Ticket'],
        screens: [['Audi 1 · IMAX', IMAX], ['Audi 2', SMALL]],
      },
      {
        name: 'Galaxy Cinemas Koramangala',
        address: '80 Feet Rd, 4th Block, Koramangala',
        lat: 12.9352,
        lng: 77.6245,
        amenities: ['Food & Beverages', 'M-Ticket'],
        screens: [['Screen 1', BIG], ['Screen 2', SMALL]],
      },
    ],
  },
  {
    city: 'Hyderabad',
    state: 'Telangana',
    theatres: [
      {
        name: 'CineBook Inorbit Cyberabad',
        address: 'Inorbit Mall, Madhapur, HITEC City',
        lat: 17.4344,
        lng: 78.3866,
        amenities: ['Parking', 'Recliners', 'Wheelchair Access', 'M-Ticket'],
        screens: [['Audi 1 · IMAX', IMAX], ['Audi 2', BIG]],
      },
      {
        name: 'Sudarshan 35mm RTC X Roads',
        address: 'RTC X Roads, Chikkadpally',
        lat: 17.4062,
        lng: 78.4977,
        amenities: ['Food & Beverages'],
        screens: [['Main Screen', BIG], ['Mini', SMALL]],
      },
    ],
  },
  {
    city: 'Mumbai',
    state: 'Maharashtra',
    theatres: [
      {
        name: 'CineBook Phoenix Palladium',
        address: 'Phoenix Palladium, Senapati Bapat Marg, Lower Parel',
        lat: 18.9946,
        lng: 72.8245,
        amenities: ['Parking', 'Recliners', 'Food Court', 'M-Ticket'],
        screens: [['Audi 1 · IMAX', IMAX], ['Audi 2', BIG]],
      },
      {
        name: 'Regal Talkies Andheri',
        address: 'SV Road, Andheri West',
        lat: 19.1197,
        lng: 72.8464,
        amenities: ['Food & Beverages', 'M-Ticket'],
        screens: [['Screen 1', BIG], ['Screen 2', SMALL]],
      },
    ],
  },
];

async function seedVenues(log: (s: string) => void) {
  for (const v of VENUES) {
    const [city] = await db().insert(cities).values({ name: v.city, state: v.state }).returning();
    for (const t of v.theatres) {
      const { screens: screenList, ...theatre } = t;
      const [th] = await db()
        .insert(theatres)
        .values({ ...theatre, cityId: city.id })
        .returning();
      for (const [name, tpl] of screenList) {
        await db().transaction((tx) => createScreen(tx, { ...tpl, theatreId: th.id, name }));
      }
    }
  }
  log('[seed] 3 cities, 6 theatres, 12 screens');
}

async function seedSnapshotMovies(log: (s: string) => void) {
  for (const { cast, ...m } of SNAPSHOT_MOVIES) {
    const [row] = await db()
      .insert(movies)
      .values({ ...m, rating: null })
      .onConflictDoNothing({ target: movies.tmdbId })
      .returning({ id: movies.id });
    if (!row || !cast.length) continue;
    await db()
      .insert(castMembers)
      .values(cast.map((c, i) => ({ movieId: row.id, ...c, orderNo: i })));
  }
  log(`[seed] ${SNAPSHOT_MOVIES.length} real movies (snapshot of Indian cinemas; set TMDB_API_KEY for a live sync)`);
}

export async function seed(log: (s: string) => void = console.log) {
  const [{ n: cityCount }] = (await db().execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM cities`)).rows;
  if (cityCount === 0) await seedVenues(log);

  await ensureAdmin(env.ADMIN_EMAIL, env.ADMIN_PASSWORD);
  log(`[seed] admin: ${env.ADMIN_EMAIL}`);

  const [{ n: movieCount }] = (await db().execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM movies`)).rows;
  if (movieCount === 0) {
    if (env.TMDB_API_KEY) {
      const r = await syncMoviesFromTmdb();
      log(`[seed] TMDB: ${r.nowShowing} now showing, ${r.upcoming} upcoming`);
    } else {
      await seedSnapshotMovies(log);
    }
  }

  const { created } = await autoSchedule(7);
  log(`[seed] ${created} showtimes scheduled over the next 7 days`);
}

export async function seedIfEmpty() {
  const [{ n }] = (await db().execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM cities`)).rows;
  if (n === 0) {
    console.log('[seed] empty database, seeding demo data…');
    await seed();
  } else {
    // Keep the rolling 7-day window full on every boot.
    await autoSchedule(7);
  }
}
