import { sql } from 'drizzle-orm';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../src/db/client.js';
import { clearCache } from '../src/lib/cache.js';
import { createShowtime } from '../src/services/venue.service.js';
import { createFixture, setupTestDb, teardownTestDb } from './helpers.js';

let app: Express;
beforeAll(async () => {
  app = await setupTestDb();
});
afterAll(teardownTestDb);

describe('catalog', () => {
  it('health check pings the database', async () => {
    const r = await request(app).get('/api/v1/health').expect(200);
    expect(r.body).toMatchObject({ ok: true, db: 'up' });
  });

  it('lists movies, filters by city and language, and searches by title', async () => {
    const f = await createFixture();
    clearCache();
    const all = await request(app).get('/api/v1/movies?status=now_showing').expect(200);
    expect(all.body.movies.map((m: { id: string }) => m.id)).toContain(f.movieId);

    const inCity = await request(app).get(`/api/v1/movies?status=now_showing&city=${f.cityId}`).expect(200);
    expect(inCity.body.movies.map((m: { id: string }) => m.id)).toEqual([f.movieId]);

    const tamil = await request(app).get(`/api/v1/movies?city=${f.cityId}&lang=Tamil`).expect(200);
    expect(tamil.body.movies).toHaveLength(0);

    const search = await request(app).get('/api/v1/movies?q=test%20movie').expect(200);
    expect(search.body.movies.length).toBeGreaterThan(0);
    await request(app).get('/api/v1/movies?q=%25%25').expect(200);
  });

  it('returns movie detail with cast and 404s on unknown ids', async () => {
    const f = await createFixture();
    const r = await request(app).get(`/api/v1/movies/${f.movieId}`).expect(200);
    expect(r.body.movie.cast[0].name).toBe('Lead Actor');
    await request(app).get('/api/v1/movies/00000000-0000-0000-0000-000000000000').expect(404);
    await request(app)
      .get('/api/v1/movies/not-a-uuid')
      .expect(422)
      .expect((res) => expect(res.body.error.code).toBe('VALIDATION_ERROR'));
  });

  it('groups showtimes by theatre for the selected day', async () => {
    const f = await createFixture(26);
    const r = await request(app).get(`/api/v1/movies/${f.movieId}/showtimes?city=${f.cityId}`).expect(200);
    expect(r.body.dates).toHaveLength(7);
    expect(r.body.theatres).toHaveLength(1);
    const chip = r.body.theatres[0].showtimes[0];
    expect(chip).toMatchObject({ id: f.showtimeId, availability: 'AVAILABLE' });
    expect(chip.total).toBe(chip.available);
  });

  it('refuses overlapping showtimes on the same screen (exclusion constraint)', async () => {
    const f = await createFixture(30);
    const st = await db().execute<{ starts_at: Date }>(sql`SELECT starts_at FROM showtimes WHERE id = ${f.showtimeId}`);
    const overlapping = new Date(new Date(st.rows[0].starts_at).getTime() + 30 * 60_000);
    await expect(
      createShowtime({
        movieId: f.movieId,
        screenId: f.screenId,
        startsAt: overlapping.toISOString(),
        language: 'Hindi',
        format: '2D',
        priceOverrides: {},
      }),
    ).rejects.toMatchObject({ code: 'SHOWTIME_OVERLAP', status: 409 });
  });
});
