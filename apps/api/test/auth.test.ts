import { sql } from 'drizzle-orm';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../src/db/client.js';
import { auth, refreshCookieFrom, setupTestDb, signup, teardownTestDb } from './helpers.js';

let app: Express;
beforeAll(async () => {
  app = await setupTestDb();
});
afterAll(teardownTestDb);

describe('auth', () => {
  it('signs up, returns an access token and an httpOnly refresh cookie', async () => {
    const res = await request(app)
      .post('/api/v1/auth/signup')
      .send({ name: 'Asha', email: 'Asha@Example.com', phone: '9876543210', password: 'secret123' })
      .expect(201);
    expect(res.body.user).toMatchObject({ email: 'asha@example.com', role: 'customer' });
    expect(res.body.user).not.toHaveProperty('passwordHash');
    expect(res.body.accessToken).toMatch(/^eyJ/);
    const cookie = (res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('cb_rt='))!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\/api\/v1\/auth/);
  });

  it('rejects a duplicate email with 409 and bad input with a 422 envelope', async () => {
    await request(app)
      .post('/api/v1/auth/signup')
      .send({ name: 'Asha', email: 'asha@example.com', phone: '9876543210', password: 'secret123' })
      .expect(409)
      .expect((r) => expect(r.body.error.code).toBe('EMAIL_TAKEN'));
    const bad = await request(app)
      .post('/api/v1/auth/signup')
      .send({ name: 'A', email: 'nope', phone: '123', password: 'short' })
      .expect(422);
    expect(bad.body.error.code).toBe('VALIDATION_ERROR');
    expect(Object.keys(bad.body.error.details.fieldErrors)).toEqual(
      expect.arrayContaining(['name', 'email', 'phone', 'password']),
    );
  });

  it('stores only a hash of the refresh token', async () => {
    const u = await signup(app);
    const raw = u.cookie.split('=')[1];
    const rows = await db().execute<{ refresh_token_hash: string }>(
      sql`SELECT refresh_token_hash FROM sessions WHERE user_id = ${u.id}`,
    );
    expect(rows.rows[0].refresh_token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows.rows[0].refresh_token_hash).not.toBe(raw);
  });

  it('logs in with the right password only', async () => {
    const u = await signup(app);
    await request(app)
      .post('/api/v1/auth/login')
      .send({ email: u.email, password: 'wrong-pass1' })
      .expect(401)
      .expect((r) => expect(r.body.error.code).toBe('INVALID_CREDENTIALS'));
    const ok = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: u.email.toUpperCase(), password: 'secret123' })
      .expect(200);
    expect(ok.body.user.email).toBe(u.email);
  });

  it('protects /me and rejects tampered tokens', async () => {
    const u = await signup(app);
    await request(app).get('/api/v1/me').expect(401);
    await request(app)
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${u.token.slice(0, -2)}xx`)
      .expect(401)
      .expect((r) => expect(r.body.error.code).toBe('TOKEN_INVALID'));
    const me = await request(app).get('/api/v1/me').set(auth(u)).expect(200);
    expect(me.body.user.id).toBe(u.id);
  });

  it('rotates the refresh token on every refresh', async () => {
    const u = await signup(app);
    const r1 = await request(app).post('/api/v1/auth/refresh').set('Cookie', u.cookie).expect(200);
    const c1 = refreshCookieFrom(r1);
    expect(c1).not.toBe(u.cookie);
    expect(r1.body.accessToken).toMatch(/^eyJ/);
    const r2 = await request(app).post('/api/v1/auth/refresh').set('Cookie', c1).expect(200);
    expect(refreshCookieFrom(r2)).not.toBe(c1);
  });

  it('treats reuse of a rotated token as theft and revokes every session', async () => {
    const u = await signup(app);
    const other = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: u.email, password: 'secret123' })
      .expect(200);
    const r1 = await request(app).post('/api/v1/auth/refresh').set('Cookie', u.cookie).expect(200);
    // Move the rotation outside the concurrent-tab grace window.
    await db().execute(sql`
      UPDATE sessions SET revoked_at = now() - interval '1 minute'
      WHERE user_id = ${u.id} AND revoked_reason = 'rotated'
    `);
    await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', u.cookie)
      .expect(401)
      .expect((r) => expect(r.body.error.code).toBe('REFRESH_REUSED'));
    // The legitimate new token and the other device are both dead now.
    await request(app).post('/api/v1/auth/refresh').set('Cookie', refreshCookieFrom(r1)).expect(401);
    await request(app).post('/api/v1/auth/refresh').set('Cookie', refreshCookieFrom(other)).expect(401);
  });

  it('does not nuke sessions when two tabs race to refresh', async () => {
    const u = await signup(app);
    const r1 = await request(app).post('/api/v1/auth/refresh').set('Cookie', u.cookie).expect(200);
    await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', u.cookie)
      .expect(401)
      .expect((r) => expect(r.body.error.code).toBe('REFRESH_RACE'));
    await request(app).post('/api/v1/auth/refresh').set('Cookie', refreshCookieFrom(r1)).expect(200);
  });

  it('logout revokes the current session only; logout-all revokes every one', async () => {
    const u = await signup(app);
    const second = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: u.email, password: 'secret123' })
      .expect(200);

    await request(app).post('/api/v1/auth/logout').set(auth(u)).expect(204);
    await request(app).post('/api/v1/auth/refresh').set('Cookie', u.cookie).expect(401);
    const still = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', refreshCookieFrom(second))
      .expect(200);

    await request(app)
      .post('/api/v1/auth/logout-all')
      .set('Authorization', `Bearer ${still.body.accessToken}`)
      .expect(204);
    await request(app).post('/api/v1/auth/refresh').set('Cookie', refreshCookieFrom(still)).expect(401);
  });
});
