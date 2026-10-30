import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../src/db/client.js';
import { sweepExpiredHolds } from '../src/services/booking.service.js';
import { auth, createFixture, setupTestDb, signup, teardownTestDb, type TestUser } from './helpers.js';

let app: Express;
beforeAll(async () => {
  app = await setupTestDb();
});
afterAll(teardownTestDb);

const hold = (u: TestUser, showtimeId: string, seatIds: string[]) =>
  request(app).post(`/api/v1/showtimes/${showtimeId}/holds`).set(auth(u)).send({ seatIds });

const pay = (u: TestUser, bookingId: string, body: object, key = randomUUID()) =>
  request(app)
    .post(`/api/v1/bookings/${bookingId}/pay`)
    .set(auth(u))
    .set('Idempotency-Key', key)
    .send(body);

const CARD_OK = { method: 'card', cardNumber: '4242 4242 4242 4242', name: 'Test User', expiry: '12/39' };
const CARD_FAIL = { method: 'card', cardNumber: '4000 0200 0000 0000', name: 'Test User', expiry: '12/39' };

async function seatStatus(showtimeId: string, seatId: string) {
  const r = await db().execute<{ status: string }>(
    sql`SELECT status FROM show_seats WHERE showtime_id = ${showtimeId} AND seat_id = ${seatId}`,
  );
  return r.rows[0]?.status;
}

describe('seat map', () => {
  it('is public, reflects blocked seats, and shows HELD vs HELD_BY_ME per viewer', async () => {
    const f = await createFixture();
    const [alice, bob] = [await signup(app), await signup(app)];

    const anon = await request(app).get(`/api/v1/showtimes/${f.showtimeId}/seats`).expect(200);
    expect(anon.body.seats.some((s: { state: string }) => s.state === 'BLOCKED')).toBe(true);
    expect(anon.body.tiers.map((t: { name: string }) => t.name)).toEqual(['Prime', 'Classic']);

    await hold(alice, f.showtimeId, [f.seatIds[0]]).expect(201);
    const asAlice = await request(app).get(`/api/v1/showtimes/${f.showtimeId}/seats`).set(auth(alice));
    const asBob = await request(app).get(`/api/v1/showtimes/${f.showtimeId}/seats`).set(auth(bob));
    const find = (r: request.Response) => r.body.seats.find((s: { id: string }) => s.id === f.seatIds[0]).state;
    expect(find(asAlice)).toBe('HELD_BY_ME');
    expect(find(asBob)).toBe('HELD');
    expect(asAlice.body.myHold?.bookingId).toBeTruthy();
    expect(JSON.stringify(asAlice.body).length).toBeLessThan(30_000);
  });
});

describe('seat holds (SEAT-3)', () => {
  it('50 concurrent requests for the same seat → exactly 1 success, 49 × 409', async () => {
    const f = await createFixture();
    const users = await Promise.all(Array.from({ length: 50 }, (_, i) => signup(app, `racer${i}`)));
    const target = f.seatIds[3];

    const results = await Promise.all(users.map((u) => hold(u, f.showtimeId, [target])));
    const statuses = results.map((r) => r.status);

    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(49);
    for (const r of results.filter((x) => x.status === 409)) {
      expect(r.body.error.code).toBe('SEATS_UNAVAILABLE');
      expect(r.body.error.details.seatIds).toEqual([target]);
    }
    const held = await db().execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM show_seats WHERE showtime_id = ${f.showtimeId} AND status = 'HELD'
    `);
    expect(held.rows[0].n).toBe(1);
    const pending = await db().execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM bookings WHERE showtime_id = ${f.showtimeId} AND status = 'PENDING'
    `);
    expect(pending.rows[0].n).toBe(1);
  });

  it('is all-or-nothing: one taken seat fails the whole request and holds nothing', async () => {
    const f = await createFixture();
    const [alice, bob] = [await signup(app), await signup(app)];
    await hold(alice, f.showtimeId, [f.seatIds[1]]).expect(201);

    const res = await hold(bob, f.showtimeId, [f.seatIds[0], f.seatIds[1], f.seatIds[2]]).expect(409);
    expect(res.body.error.details.seatIds).toEqual([f.seatIds[1]]);
    expect(await seatStatus(f.showtimeId, f.seatIds[0])).toBe('AVAILABLE');
    expect(await seatStatus(f.showtimeId, f.seatIds[2])).toBe('AVAILABLE');
  });

  it('prices seats from tiers and adds ₹30/ticket fee + 18% GST on the fee', async () => {
    const f = await createFixture();
    const u = await signup(app);
    const res = await hold(u, f.showtimeId, [f.seatIds[0], f.seatIds[1]]).expect(201);
    const p = res.body.pricing;
    expect(p.feePaise).toBe(6000);
    expect(p.taxPaise).toBe(1080);
    expect(p.totalPaise).toBe(p.subtotalPaise + 6000 + 1080);
    expect(p.seats.every((s: { pricePaise: number }) => Number.isInteger(s.pricePaise))).toBe(true);
  });

  it('keeps one active hold per user per showtime', async () => {
    const f = await createFixture();
    const u = await signup(app);
    const first = await hold(u, f.showtimeId, [f.seatIds[0]]).expect(201);
    await hold(u, f.showtimeId, [f.seatIds[1]]).expect(201);
    expect(await seatStatus(f.showtimeId, f.seatIds[0])).toBe('AVAILABLE');
    expect(await seatStatus(f.showtimeId, f.seatIds[1])).toBe('HELD');
    const old = await db().execute<{ status: string }>(
      sql`SELECT status FROM bookings WHERE id = ${first.body.bookingId}`,
    );
    expect(old.rows[0].status).toBe('EXPIRED');
  });

  it('lets anyone reclaim an expired hold inline, before the sweeper runs', async () => {
    const f = await createFixture();
    const [alice, bob] = [await signup(app), await signup(app)];
    await hold(alice, f.showtimeId, [f.seatIds[0]]).expect(201);
    await db().execute(sql`
      UPDATE show_seats SET hold_expires_at = now() - interval '1 second'
      WHERE showtime_id = ${f.showtimeId} AND seat_id = ${f.seatIds[0]}
    `);
    await hold(bob, f.showtimeId, [f.seatIds[0]]).expect(201);
  });

  it('releases a hold when the user backs out', async () => {
    const f = await createFixture();
    const u = await signup(app);
    const h = await hold(u, f.showtimeId, [f.seatIds[0]]).expect(201);
    await request(app).delete(`/api/v1/holds/${h.body.bookingId}`).set(auth(u)).expect(204);
    expect(await seatStatus(f.showtimeId, f.seatIds[0])).toBe('AVAILABLE');
  });

  it('requires sign-in and validates input', async () => {
    const f = await createFixture();
    const u = await signup(app);
    await request(app).post(`/api/v1/showtimes/${f.showtimeId}/holds`).send({ seatIds: [f.seatIds[0]] }).expect(401);
    await hold(u, f.showtimeId, []).expect(422);
    await hold(u, f.showtimeId, f.seatIds.slice(0, 11)).expect(422);
  });
});

describe('payment (PAY-1..3) and booking', () => {
  it('confirms on success, books the seats, and returns a QR ticket', async () => {
    const f = await createFixture();
    const u = await signup(app);
    const h = await hold(u, f.showtimeId, [f.seatIds[0], f.seatIds[1]]).expect(201);
    const res = await pay(u, h.body.bookingId, CARD_OK).expect(200);
    expect(res.body).toMatchObject({ status: 'SUCCESS', bookingStatus: 'CONFIRMED', replayed: false });
    expect(await seatStatus(f.showtimeId, f.seatIds[0])).toBe('BOOKED');

    const ticket = await request(app).get(`/api/v1/bookings/${h.body.bookingId}`).set(auth(u)).expect(200);
    expect(ticket.body.booking.status).toBe('CONFIRMED');
    expect(ticket.body.booking.code).toMatch(/^CB[A-Z0-9]{6}$/);
    expect(ticket.body.booking.qrDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(ticket.body.booking.payment.instrument).toBe('•••• 4242');

    const list = await request(app).get('/api/v1/bookings?scope=upcoming').set(auth(u)).expect(200);
    expect(list.body.bookings.map((b: { id: string }) => b.id)).toContain(h.body.bookingId);
  });

  it('never stores the full card number', async () => {
    const f = await createFixture();
    const u = await signup(app);
    const h = await hold(u, f.showtimeId, [f.seatIds[0]]).expect(201);
    await pay(u, h.body.bookingId, CARD_OK).expect(200);
    const dump = await db().execute(sql`SELECT row_to_json(p)::text AS j FROM payments p WHERE booking_id = ${h.body.bookingId}`);
    expect(JSON.stringify(dump.rows)).not.toContain('4242424242424242');
  });

  it('is idempotent: same key replays the original result, double-clicks charge once', async () => {
    const f = await createFixture();
    const u = await signup(app);
    const h = await hold(u, f.showtimeId, [f.seatIds[0]]).expect(201);
    const key = randomUUID();
    const [a, b] = await Promise.all([
      pay(u, h.body.bookingId, CARD_OK, key),
      pay(u, h.body.bookingId, CARD_OK, key),
    ]);
    const ok = [a, b].filter((r) => r.status === 200);
    expect(ok.length).toBeGreaterThanOrEqual(1);
    for (const r of [a, b]) expect([200, 409]).toContain(r.status);

    const replay = await pay(u, h.body.bookingId, CARD_OK, key).expect(200);
    expect(replay.body).toMatchObject({ status: 'SUCCESS', replayed: true, paymentId: ok[0].body.paymentId });

    const count = await db().execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM payments WHERE booking_id = ${h.body.bookingId}`,
    );
    expect(count.rows[0].n).toBe(1);
    // A new key on an already-paid booking is refused, not charged.
    await pay(u, h.body.bookingId, CARD_OK).expect(409);
  });

  it('card ending 0000 fails, marks the booking FAILED and releases the seats', async () => {
    const f = await createFixture();
    const u = await signup(app);
    const h = await hold(u, f.showtimeId, [f.seatIds[0]]).expect(201);
    const res = await pay(u, h.body.bookingId, CARD_FAIL).expect(200);
    expect(res.body).toMatchObject({ status: 'FAILED', bookingStatus: 'FAILED' });
    expect(await seatStatus(f.showtimeId, f.seatIds[0])).toBe('AVAILABLE');
  });

  it('returns 410 HOLD_EXPIRED when paying after the timer', async () => {
    const f = await createFixture();
    const u = await signup(app);
    const h = await hold(u, f.showtimeId, [f.seatIds[0]]).expect(201);
    await db().execute(sql`UPDATE bookings SET hold_expires_at = now() - interval '1 second' WHERE id = ${h.body.bookingId}`);
    const res = await pay(u, h.body.bookingId, CARD_OK).expect(410);
    expect(res.body.error.code).toBe('HOLD_EXPIRED');
  });

  it('refunds and returns 410 if the seat hold lapses mid-payment', async () => {
    const f = await createFixture();
    const u = await signup(app);
    const h = await hold(u, f.showtimeId, [f.seatIds[0]]).expect(201);
    // Booking still looks live, but the seat's own hold has lapsed (e.g. reclaimed).
    await db().execute(sql`UPDATE show_seats SET hold_expires_at = now() - interval '1 second' WHERE hold_id = ${h.body.bookingId}`);
    const key = randomUUID();
    await pay(u, h.body.bookingId, CARD_OK, key).expect(410);
    const p = await db().execute<{ status: string }>(sql`SELECT status FROM payments WHERE idempotency_key = ${key}`);
    expect(p.rows[0].status).toBe('REFUNDED');
    expect(await seatStatus(f.showtimeId, f.seatIds[0])).toBe('AVAILABLE');
  });

  it('requires an Idempotency-Key and a valid instrument', async () => {
    const f = await createFixture();
    const u = await signup(app);
    const h = await hold(u, f.showtimeId, [f.seatIds[0]]).expect(201);
    await request(app).post(`/api/v1/bookings/${h.body.bookingId}/pay`).set(auth(u)).send(CARD_OK).expect(400);
    await pay(u, h.body.bookingId, { ...CARD_OK, cardNumber: '4242 4242 4242 4241' }).expect(422);
    await pay(u, h.body.bookingId, { method: 'upi', upiId: 'not-an-upi' }).expect(422);
  });

  it("refuses to let another user pay for or view someone else's booking", async () => {
    const f = await createFixture();
    const [alice, mallory] = [await signup(app), await signup(app)];
    const h = await hold(alice, f.showtimeId, [f.seatIds[0]]).expect(201);
    await pay(mallory, h.body.bookingId, CARD_OK).expect(403);
    await request(app).get(`/api/v1/bookings/${h.body.bookingId}`).set(auth(mallory)).expect(404);
  });

  it('rejects pay from a signed-out session even with an unexpired access token', async () => {
    const f = await createFixture();
    const u = await signup(app);
    const h = await hold(u, f.showtimeId, [f.seatIds[0]]).expect(201);
    await request(app).post('/api/v1/auth/logout-all').set(auth(u)).expect(204);
    const res = await pay(u, h.body.bookingId, CARD_OK).expect(401);
    expect(res.body.error.code).toBe('SESSION_REVOKED');
  });
});

describe('cancellation (BOOK-3)', () => {
  it('cancels ≥ 2 h before the show: seats return, payment refunded', async () => {
    const f = await createFixture(24);
    const u = await signup(app);
    const h = await hold(u, f.showtimeId, [f.seatIds[0]]).expect(201);
    await pay(u, h.body.bookingId, { method: 'upi', upiId: 'asha@okbank' }).expect(200);
    const res = await request(app).post(`/api/v1/bookings/${h.body.bookingId}/cancel`).set(auth(u)).expect(200);
    expect(res.body.booking.status).toBe('CANCELLED');
    expect(res.body.booking.payment.status).toBe('REFUNDED');
    expect(await seatStatus(f.showtimeId, f.seatIds[0])).toBe('AVAILABLE');
  });

  it('refuses within 2 h of the show', async () => {
    const f = await createFixture(1);
    const u = await signup(app);
    const h = await hold(u, f.showtimeId, [f.seatIds[0]]).expect(201);
    await pay(u, h.body.bookingId, { method: 'netbanking', bank: 'HDFC' }).expect(200);
    const res = await request(app).post(`/api/v1/bookings/${h.body.bookingId}/cancel`).set(auth(u)).expect(409);
    expect(res.body.error.code).toBe('CANCEL_WINDOW_CLOSED');
  });
});

describe('expiry sweeper', () => {
  it('expires stale PENDING bookings and frees their seats', async () => {
    const f = await createFixture();
    const u = await signup(app);
    const h = await hold(u, f.showtimeId, [f.seatIds[0]]).expect(201);
    await db().execute(sql`UPDATE bookings SET hold_expires_at = now() - interval '1 second' WHERE id = ${h.body.bookingId}`);
    await db().execute(sql`UPDATE show_seats SET hold_expires_at = now() - interval '1 second' WHERE hold_id = ${h.body.bookingId}`);
    const r = await sweepExpiredHolds();
    expect(r.expiredBookings).toBeGreaterThanOrEqual(1);
    expect(await seatStatus(f.showtimeId, f.seatIds[0])).toBe('AVAILABLE');
  });
});

describe('ticket validation (signed QR + one-time check-in)', () => {
  async function adminToken() {
    const { ensureAdmin } = await import('../src/services/auth.service.js');
    await ensureAdmin('gate.staff@example.com', 'staffpass123');
    const r = await request(app).post('/api/v1/auth/login').send({ email: 'gate.staff@example.com', password: 'staffpass123' }).expect(200);
    return { Authorization: `Bearer ${r.body.accessToken}` };
  }
  async function confirmedTicket() {
    const f = await createFixture(24);
    const u = await signup(app);
    const h = await hold(u, f.showtimeId, [f.seatIds[0]]).expect(201);
    await pay(u, h.body.bookingId, CARD_OK).expect(200);
    const { ticketPayload } = await import('../src/lib/ticket.js');
    const b = (await request(app).get(`/api/v1/bookings/${h.body.bookingId}`).set(auth(u))).body.booking;
    return { u, bookingId: b.id as string, payload: ticketPayload(b.id, b.code) };
  }
  const verify = (headers: object, payload: string, checkIn = true) =>
    request(app).post('/api/v1/admin/tickets/verify').set(headers).send({ payload, checkIn });

  it('admits a genuine ticket exactly once', async () => {
    const staff = await adminToken();
    const { payload } = await confirmedTicket();
    expect((await verify(staff, payload).expect(200)).body).toMatchObject({ valid: true, verdict: 'VALID' });
    expect((await verify(staff, payload).expect(200)).body).toMatchObject({ valid: false, verdict: 'ALREADY_CHECKED_IN' });
  });

  it('rejects forged, tampered and malformed tickets', async () => {
    const staff = await adminToken();
    const { payload } = await confirmedTicket();
    const [p, id, code, sig] = payload.split('.');
    const flipped = sig[0] === 'A' ? 'B' + sig.slice(1) : 'A' + sig.slice(1);
    expect((await verify(staff, `${p}.${id}.${code}.${flipped}`)).body.verdict).toBe('BAD_SIGNATURE');
    expect((await verify(staff, `${p}.${id}.CBZZZZZZ.${sig}`)).body.verdict).toBe('BAD_SIGNATURE');
    expect((await verify(staff, `CINEBOOK:${code}:${id}`)).body.verdict).toBe('MALFORMED');
  });

  it('rejects a cancelled booking and refuses non-staff callers', async () => {
    const staff = await adminToken();
    const { u, bookingId, payload } = await confirmedTicket();
    await request(app).post(`/api/v1/bookings/${bookingId}/cancel`).set(auth(u)).expect(200);
    expect((await verify(staff, payload, false)).body.verdict).toBe('NOT_CONFIRMED');
    await verify(auth(u), payload).expect(403);
  });

  it('admits once even when two gates scan simultaneously', async () => {
    const staff = await adminToken();
    const { payload } = await confirmedTicket();
    const results = await Promise.all(Array.from({ length: 10 }, () => verify(staff, payload)));
    expect(results.filter((r) => r.body.verdict === 'VALID')).toHaveLength(1);
  });
});
