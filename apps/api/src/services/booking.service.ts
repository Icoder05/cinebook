import { randomInt, randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, lt, or, sql } from 'drizzle-orm';
import QRCode from 'qrcode';
import {
  type BookingDetail,
  type BookingListItem,
  CANCEL_CUTOFF_HOURS,
  cardOutcome,
  computeTotals,
  type FakeOutcome,
  type HoldResponse,
  type PayInput,
  type PayResponse,
  resolveTierPrice,
  upiOutcome,
} from '@cinebook/shared';
import { db, type Executor } from '../db/client.js';
import {
  bookings,
  bookingSeats,
  payments,
  seats,
  seatTiers,
  showSeats,
  showtimes,
} from '../db/schema.js';
import { env } from '../env.js';
import { AppError, conflict, forbidden, notFound, PG, pgCode } from '../lib/errors.js';
import { ticketPayload, verifyTicketPayload } from '../lib/ticket.js';
import { sleep } from '../lib/time.js';

/** Columns that return a show_seat to the pool. */
const RELEASED = {
  status: 'AVAILABLE' as const,
  heldBy: null,
  holdId: null,
  holdExpiresAt: null,
  bookingId: null,
  version: sql`${showSeats.version} + 1`,
};

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function bookingCode(): string {
  let s = 'CB';
  for (let i = 0; i < 6; i++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return s;
}

async function releaseHoldSeats(ex: Executor, holdIds: string[]) {
  if (!holdIds.length) return;
  await ex
    .update(showSeats)
    .set(RELEASED)
    .where(and(inArray(showSeats.holdId, holdIds), eq(showSeats.status, 'HELD')));
}

// ---------------------------------------------------------------------------
// SEAT-3: atomic hold of 1–10 seats for HOLD_MINUTES, all-or-nothing.
// ---------------------------------------------------------------------------

export async function createHold(
  userId: string,
  showtimeId: string,
  seatIds: string[],
): Promise<HoldResponse> {
  const [st] = await db()
    .select({
      id: showtimes.id,
      status: showtimes.status,
      startsAt: showtimes.startsAt,
      priceOverrides: showtimes.priceOverrides,
    })
    .from(showtimes)
    .where(eq(showtimes.id, showtimeId))
    .limit(1);
  if (!st) throw notFound('Showtime');
  if (st.status !== 'SCHEDULED' || st.startsAt.getTime() <= Date.now()) {
    throw conflict('SHOWTIME_CLOSED', 'Booking is closed for this show');
  }

  const bookingId = randomUUID();
  try {
    return await db().transaction(async (tx) => {
      // One active hold per user per showtime: a new hold replaces the old one.
      const previous = await tx
        .update(bookings)
        .set({ status: 'EXPIRED' })
        .where(
          and(
            eq(bookings.userId, userId),
            eq(bookings.showtimeId, showtimeId),
            eq(bookings.status, 'PENDING'),
          ),
        )
        .returning({ id: bookings.id });
      await releaseHoldSeats(tx, previous.map((p) => p.id));

      // The database, not this process, decides who wins. Rows another transaction
      // holds are re-checked after it commits, so a seat can only be claimed once.
      const claimed = await tx
        .update(showSeats)
        .set({
          status: 'HELD',
          heldBy: userId,
          holdId: bookingId,
          holdExpiresAt: sql`now() + make_interval(mins => ${env.HOLD_MINUTES})`,
          version: sql`${showSeats.version} + 1`,
        })
        .where(
          and(
            eq(showSeats.showtimeId, showtimeId),
            inArray(showSeats.seatId, seatIds),
            or(
              eq(showSeats.status, 'AVAILABLE'),
              // Expired holds are reclaimable inline; correctness never waits on the sweeper.
              and(eq(showSeats.status, 'HELD'), lt(showSeats.holdExpiresAt, sql`now()`)),
            ),
          ),
        )
        .returning({ seatId: showSeats.seatId, holdExpiresAt: showSeats.holdExpiresAt });

      if (claimed.length !== seatIds.length) {
        const got = new Set(claimed.map((c) => c.seatId));
        throw conflict('SEATS_UNAVAILABLE', 'Some of those seats were just taken', {
          seatIds: seatIds.filter((id) => !got.has(id)),
        });
      }

      const seatRows = await tx
        .select({
          seatId: seats.id,
          row: seats.rowLabel,
          col: seats.colNo,
          tierId: seatTiers.id,
          tierName: seatTiers.name,
          basePricePaise: seatTiers.basePricePaise,
          sortOrder: seatTiers.sortOrder,
        })
        .from(seats)
        .innerJoin(seatTiers, eq(seatTiers.id, seats.tierId))
        .where(inArray(seats.id, seatIds))
        .orderBy(seatTiers.sortOrder, seats.rowLabel, seats.colNo);

      const priced = seatRows.map((s) => ({
        seatId: s.seatId,
        label: `${s.row}${s.col}`,
        tierName: s.tierName,
        pricePaise: resolveTierPrice(s.tierId, s.basePricePaise, st.priceOverrides),
      }));
      const totals = computeTotals(priced.map((p) => p.pricePaise));
      const holdExpiresAt = claimed[0].holdExpiresAt!;

      await tx.insert(bookings).values({
        id: bookingId,
        code: bookingCode(),
        userId,
        showtimeId,
        status: 'PENDING',
        seatCount: priced.length,
        ...totals,
        holdExpiresAt,
      });
      await tx.insert(bookingSeats).values(
        priced.map((p) => ({
          bookingId,
          seatId: p.seatId,
          seatLabel: p.label,
          tierName: p.tierName,
          pricePaise: p.pricePaise,
        })),
      );

      return {
        bookingId,
        holdExpiresAt: holdExpiresAt.toISOString(),
        pricing: { seats: priced, ...totals },
      };
    });
  } catch (err) {
    // Two holds locking overlapping seats in different orders can deadlock; Postgres
    // aborts one of them. To the loser that is simply "seats unavailable".
    const code = pgCode(err);
    if (code === PG.deadlockDetected || code === PG.serializationFailure) {
      throw conflict('SEATS_UNAVAILABLE', 'Some of those seats were just taken', { seatIds });
    }
    throw err;
  }
}

/** DELETE /holds/:bookingId — user backs out before paying. */
export async function releaseHold(userId: string, bookingId: string) {
  await db().transaction(async (tx) => {
    const [b] = await tx
      .update(bookings)
      .set({ status: 'EXPIRED' })
      .where(and(eq(bookings.id, bookingId), eq(bookings.userId, userId), eq(bookings.status, 'PENDING')))
      .returning({ id: bookings.id });
    if (!b) throw notFound('Active hold');
    await releaseHoldSeats(tx, [b.id]);
  });
}

/** Clean-up only: expired holds are already reclaimable inline. */
export async function sweepExpiredHolds() {
  return db().transaction(async (tx) => {
    const expired = await tx
      .update(bookings)
      .set({ status: 'EXPIRED' })
      .where(and(eq(bookings.status, 'PENDING'), lt(bookings.holdExpiresAt, sql`now()`)))
      .returning({ id: bookings.id });
    const released = await tx
      .update(showSeats)
      .set(RELEASED)
      .where(and(eq(showSeats.status, 'HELD'), lt(showSeats.holdExpiresAt, sql`now()`)))
      .returning({ seatId: showSeats.seatId });
    return { expiredBookings: expired.length, releasedSeats: released.length };
  });
}

// ---------------------------------------------------------------------------
// PAY-1..3: fake gateway with deterministic outcomes and idempotent confirm.
// ---------------------------------------------------------------------------

type PaymentRow = typeof payments.$inferSelect;

function instrumentOf(input: PayInput): string {
  switch (input.method) {
    case 'card':
      return `•••• ${input.cardNumber.slice(-4)}`;
    case 'upi':
      return input.upiId.toLowerCase();
    case 'netbanking':
      return input.bank;
  }
}

function outcomeOf(input: PayInput): FakeOutcome {
  switch (input.method) {
    case 'card':
      return cardOutcome(input.cardNumber);
    case 'upi':
      return upiOutcome(input.upiId);
    case 'netbanking':
      return 'SUCCESS';
  }
}

async function replay(p: PaymentRow): Promise<PayResponse> {
  if (p.status === 'INITIATED') {
    throw conflict('PAYMENT_IN_PROGRESS', 'This payment is still being processed. Retry in a moment.');
  }
  if (p.status === 'REFUNDED') {
    throw new AppError(410, 'HOLD_EXPIRED', 'Your seat hold expired before payment completed. Any amount is refunded.');
  }
  const [b] = await db()
    .select({ status: bookings.status })
    .from(bookings)
    .where(eq(bookings.id, p.bookingId))
    .limit(1);
  return {
    paymentId: p.id,
    status: p.status,
    bookingId: p.bookingId,
    bookingStatus: b.status,
    fakeTxnRef: p.fakeTxnRef,
    failureReason: p.failureReason,
    replayed: true,
  };
}

export async function pay(
  userId: string,
  bookingId: string,
  idempotencyKey: string,
  input: PayInput,
): Promise<PayResponse> {
  const [b] = await db().select().from(bookings).where(eq(bookings.id, bookingId)).limit(1);
  if (!b) throw notFound('Booking');
  if (b.userId !== userId) throw forbidden();

  // PAY-3: same key → same answer, no second charge.
  const [prior] = await db()
    .select()
    .from(payments)
    .where(eq(payments.idempotencyKey, idempotencyKey))
    .limit(1);
  if (prior) {
    if (prior.bookingId !== bookingId) {
      throw new AppError(422, 'IDEMPOTENCY_KEY_REUSED', 'This Idempotency-Key belongs to another booking');
    }
    return replay(prior);
  }

  if (b.status === 'CONFIRMED') throw conflict('ALREADY_PAID', 'This booking is already paid');
  if (b.status === 'FAILED') throw conflict('BOOKING_FAILED', 'This booking failed; please pick seats again');
  if (b.status !== 'PENDING' || !b.holdExpiresAt || b.holdExpiresAt.getTime() <= Date.now()) {
    throw new AppError(410, 'HOLD_EXPIRED', 'Your seat hold has expired. Please pick seats again.');
  }

  let payment: PaymentRow;
  try {
    const inserted = await db()
      .insert(payments)
      .values({
        bookingId,
        idempotencyKey,
        method: input.method,
        instrument: instrumentOf(input),
        status: 'INITIATED',
        amountPaise: b.totalPaise,
      })
      .onConflictDoNothing({ target: payments.idempotencyKey })
      .returning();
    if (!inserted[0]) {
      // Lost a race against a double-click carrying the same key.
      const [p] = await db().select().from(payments).where(eq(payments.idempotencyKey, idempotencyKey));
      return replay(p);
    }
    payment = inserted[0];
  } catch (err) {
    if (pgCode(err) === PG.uniqueViolation) {
      // payments_one_live_per_booking: a different key is already paying for this booking.
      throw conflict('PAYMENT_IN_PROGRESS', 'A payment for this booking is already in progress');
    }
    throw err;
  }

  await sleep(env.PAYMENT_DELAY_MS); // "talking to the bank"
  const outcome = outcomeOf(input);
  const result = await finalize(payment, outcome);

  if (outcome === 'TIMEOUT' && result.status === 'SUCCESS') {
    // The bank "never answers": the payment is settled server-side, but the client
    // times out first and must retry with the same key to learn the result.
    await sleep(env.PAYMENT_TIMEOUT_DELAY_MS);
  }
  return result;
}

async function finalize(payment: PaymentRow, outcome: FakeOutcome): Promise<PayResponse> {
  const result = await settle(payment, outcome);
  if (result === 'HOLD_EXPIRED') {
    // Thrown after commit so the refund we just recorded is kept.
    throw new AppError(410, 'HOLD_EXPIRED', 'Your seat hold expired before payment completed. The amount has been refunded.');
  }
  return result;
}

function settle(payment: PaymentRow, outcome: FakeOutcome): Promise<PayResponse | 'HOLD_EXPIRED'> {
  const fakeTxnRef = `TXN${Date.now().toString(36).toUpperCase()}${randomInt(1000, 9999)}`;
  return db().transaction(async (tx): Promise<PayResponse | 'HOLD_EXPIRED'> => {
    const [b] = await tx
      .select()
      .from(bookings)
      .where(eq(bookings.id, payment.bookingId))
      .for('update');

    if (outcome === 'FAIL') {
      const reason =
        payment.method === 'upi'
          ? 'UPI request was declined (test UPI id)'
          : 'Card declined by issuer (test card ending 0000)';
      await tx
        .update(payments)
        .set({ status: 'FAILED', failureReason: reason, fakeTxnRef, updatedAt: sql`now()` })
        .where(eq(payments.id, payment.id));
      if (b.status === 'PENDING') {
        await tx.update(bookings).set({ status: 'FAILED' }).where(eq(bookings.id, b.id));
        await releaseHoldSeats(tx, [b.id]);
      }
      return {
        paymentId: payment.id,
        status: 'FAILED',
        bookingId: b.id,
        bookingStatus: b.status === 'PENDING' ? 'FAILED' : b.status,
        fakeTxnRef,
        failureReason: reason,
        replayed: false,
      };
    }

    // SUCCESS: HELD → BOOKED, but only seats still held by *this* booking and not expired.
    const booked =
      b.status === 'PENDING'
        ? await tx
            .update(showSeats)
            .set({
              status: 'BOOKED',
              bookingId: b.id,
              holdExpiresAt: null,
              version: sql`${showSeats.version} + 1`,
            })
            .where(
              and(
                eq(showSeats.holdId, b.id),
                eq(showSeats.status, 'HELD'),
                sql`${showSeats.holdExpiresAt} > now()`,
              ),
            )
            .returning({ seatId: showSeats.seatId })
        : [];

    if (booked.length !== b.seatCount) {
      // The hold lapsed while we were "charging": refund and give the seats back.
      await tx
        .update(payments)
        .set({
          status: 'REFUNDED',
          fakeTxnRef,
          failureReason: 'Seat hold expired before payment completed',
          updatedAt: sql`now()`,
        })
        .where(eq(payments.id, payment.id));
      if (booked.length) {
        await tx
          .update(showSeats)
          .set(RELEASED)
          .where(and(eq(showSeats.bookingId, b.id), eq(showSeats.status, 'BOOKED')));
      }
      await releaseHoldSeats(tx, [b.id]);
      if (b.status === 'PENDING') {
        await tx.update(bookings).set({ status: 'EXPIRED' }).where(eq(bookings.id, b.id));
      }
      return 'HOLD_EXPIRED';
    }

    await tx
      .update(payments)
      .set({ status: 'SUCCESS', fakeTxnRef, updatedAt: sql`now()` })
      .where(eq(payments.id, payment.id));
    await tx
      .update(bookings)
      .set({ status: 'CONFIRMED', confirmedAt: sql`now()` })
      .where(eq(bookings.id, b.id));
    return {
      paymentId: payment.id,
      status: 'SUCCESS',
      bookingId: b.id,
      bookingStatus: 'CONFIRMED',
      fakeTxnRef,
      failureReason: null,
      replayed: false,
    };
  });
}

// ---------------------------------------------------------------------------
// BOOK-1..3: tickets, My Bookings, cancellation.
// ---------------------------------------------------------------------------

const cancelCutoffMs = CANCEL_CUTOFF_HOURS * 3600_000;

export async function getBooking(
  bookingId: string,
  viewer: { id: string; role: string },
): Promise<BookingDetail> {
  const res = await db().execute<{
    id: string;
    code: string;
    user_id: string;
    status: BookingDetail['status'];
    seat_count: number;
    subtotal_paise: number;
    fee_paise: number;
    tax_paise: number;
    total_paise: number;
    hold_expires_at: string | Date | null;
    created_at: string | Date;
    confirmed_at: string | Date | null;
    cancelled_at: string | Date | null;
    movie_id: string;
    title: string;
    poster_path: string | null;
    certificate: string | null;
    languages: string[];
    showtime_id: string;
    starts_at: string | Date;
    format: BookingDetail['showtime']['format'];
    language: string;
    theatre_name: string;
    address: string;
    city: string;
    screen_name: string;
  }>(sql`
    SELECT b.id, b.code, b.user_id, b.status, b.seat_count, b.subtotal_paise, b.fee_paise,
           b.tax_paise, b.total_paise, b.hold_expires_at, b.created_at, b.confirmed_at, b.cancelled_at,
           m.id AS movie_id, m.title, m.poster_path, m.certificate, m.languages,
           st.id AS showtime_id, st.starts_at, st.format, st.language,
           t.name AS theatre_name, t.address, c.name AS city, sc.name AS screen_name
    FROM bookings b
    JOIN showtimes st ON st.id = b.showtime_id
    JOIN movies m ON m.id = st.movie_id
    JOIN screens sc ON sc.id = st.screen_id
    JOIN theatres t ON t.id = sc.theatre_id
    JOIN cities c ON c.id = t.city_id
    WHERE b.id = ${bookingId}
  `);
  const r = res.rows[0];
  if (!r) throw notFound('Booking');
  if (r.user_id !== viewer.id && viewer.role !== 'admin') throw notFound('Booking');

  const [seatRows, [payment]] = await Promise.all([
    db()
      .select({
        seatId: bookingSeats.seatId,
        label: bookingSeats.seatLabel,
        tierName: bookingSeats.tierName,
        pricePaise: bookingSeats.pricePaise,
      })
      .from(bookingSeats)
      .where(eq(bookingSeats.bookingId, bookingId)),
    db()
      .select()
      .from(payments)
      .where(eq(payments.bookingId, bookingId))
      .orderBy(desc(payments.createdAt))
      .limit(1),
  ]);
  seatRows.sort((a, b) => a.label.localeCompare(b.label, 'en', { numeric: true }));

  const startsAt = new Date(r.starts_at);
  const iso = (v: string | Date | null) => (v ? new Date(v).toISOString() : null);
  const qrDataUrl =
    r.status === 'CONFIRMED'
      ? await QRCode.toDataURL(ticketPayload(r.id, r.code), { margin: 1, width: 240 })
      : null;

  return {
    id: r.id,
    code: r.code,
    status: r.status,
    seatCount: r.seat_count,
    subtotalPaise: r.subtotal_paise,
    feePaise: r.fee_paise,
    taxPaise: r.tax_paise,
    totalPaise: r.total_paise,
    holdExpiresAt: iso(r.hold_expires_at),
    createdAt: iso(r.created_at)!,
    confirmedAt: iso(r.confirmed_at),
    cancelledAt: iso(r.cancelled_at),
    canCancel: r.status === 'CONFIRMED' && startsAt.getTime() - Date.now() >= cancelCutoffMs,
    serverTime: new Date().toISOString(),
    seats: seatRows,
    movie: {
      id: r.movie_id,
      title: r.title,
      posterPath: r.poster_path,
      certificate: r.certificate,
      languages: r.languages,
    },
    showtime: { id: r.showtime_id, startsAt: startsAt.toISOString(), format: r.format, language: r.language },
    theatre: { name: r.theatre_name, address: r.address, city: r.city },
    screen: { name: r.screen_name },
    payment: payment
      ? {
          method: payment.method,
          instrument: payment.instrument,
          status: payment.status,
          amountPaise: payment.amountPaise,
          fakeTxnRef: payment.fakeTxnRef,
          failureReason: payment.failureReason,
        }
      : null,
    qrDataUrl,
  };
}

export async function listBookings(userId: string, scope: 'upcoming' | 'past'): Promise<BookingListItem[]> {
  const res = await db().execute<{
    id: string;
    code: string;
    status: BookingListItem['status'];
    seat_count: number;
    total_paise: number;
    seat_labels: string[];
    movie_id: string;
    title: string;
    poster_path: string | null;
    starts_at: string | Date;
    format: BookingListItem['showtime']['format'];
    language: string;
    theatre_name: string;
    city: string;
  }>(sql`
    SELECT b.id, b.code, b.status, b.seat_count, b.total_paise,
           (SELECT array_agg(bs.seat_label ORDER BY bs.seat_label) FROM booking_seats bs WHERE bs.booking_id = b.id) AS seat_labels,
           m.id AS movie_id, m.title, m.poster_path,
           st.starts_at, st.format, st.language, t.name AS theatre_name, c.name AS city
    FROM bookings b
    JOIN showtimes st ON st.id = b.showtime_id
    JOIN movies m ON m.id = st.movie_id
    JOIN screens sc ON sc.id = st.screen_id
    JOIN theatres t ON t.id = sc.theatre_id
    JOIN cities c ON c.id = t.city_id
    WHERE b.user_id = ${userId}
      AND b.status IN ('CONFIRMED', 'CANCELLED')
      AND ${
        scope === 'upcoming'
          ? sql`b.status = 'CONFIRMED' AND st.starts_at > now()`
          : sql`(b.status = 'CANCELLED' OR st.starts_at <= now())`
      }
    ORDER BY ${scope === 'upcoming' ? sql`st.starts_at ASC` : sql`st.starts_at DESC`}
    LIMIT 100
  `);
  return res.rows.map((r) => ({
    id: r.id,
    code: r.code,
    status: r.status,
    seatCount: r.seat_count,
    totalPaise: r.total_paise,
    seatLabels: r.seat_labels ?? [],
    movie: { id: r.movie_id, title: r.title, posterPath: r.poster_path },
    showtime: { startsAt: new Date(r.starts_at).toISOString(), format: r.format, language: r.language },
    theatre: { name: r.theatre_name, city: r.city },
  }));
}

/** CONFIRMED → CANCELLED up to 2 h before the show; seats go back, payment is "refunded". */
export async function cancelBooking(userId: string, bookingId: string) {
  await db().transaction(async (tx) => {
    const [b] = await tx
      .select({
        id: bookings.id,
        userId: bookings.userId,
        status: bookings.status,
        startsAt: showtimes.startsAt,
      })
      .from(bookings)
      .innerJoin(showtimes, eq(showtimes.id, bookings.showtimeId))
      .where(eq(bookings.id, bookingId))
      .for('update', { of: bookings });
    if (!b || b.userId !== userId) throw notFound('Booking');
    if (b.status !== 'CONFIRMED') throw conflict('NOT_CANCELLABLE', 'Only confirmed bookings can be cancelled');
    if (b.startsAt.getTime() - Date.now() < cancelCutoffMs) {
      throw conflict(
        'CANCEL_WINDOW_CLOSED',
        `Bookings can be cancelled up to ${CANCEL_CUTOFF_HOURS} hours before the show`,
      );
    }
    await tx
      .update(bookings)
      .set({ status: 'CANCELLED', cancelledAt: sql`now()` })
      .where(eq(bookings.id, b.id));
    await tx
      .update(showSeats)
      .set(RELEASED)
      .where(and(eq(showSeats.bookingId, b.id), eq(showSeats.status, 'BOOKED')));
    await tx
      .update(payments)
      .set({ status: 'REFUNDED', updatedAt: sql`now()` })
      .where(and(eq(payments.bookingId, b.id), eq(payments.status, 'SUCCESS')));
  });
}

// ---------------------------------------------------------------------------
// Ticket validation at the venue (signed QR + one-time check-in).
// ---------------------------------------------------------------------------

export type TicketVerdict =
  | 'VALID'
  | 'MALFORMED'
  | 'BAD_SIGNATURE'
  | 'NOT_FOUND'
  | 'NOT_CONFIRMED'
  | 'ALREADY_CHECKED_IN';

export async function verifyTicket(payload: string, checkIn = true) {
  const parsed = verifyTicketPayload(payload);
  if (!parsed.ok) return { valid: false, verdict: parsed.reason as TicketVerdict };

  const [b] = await db()
    .select({ id: bookings.id, code: bookings.code, status: bookings.status, seatCount: bookings.seatCount, checkedInAt: bookings.checkedInAt })
    .from(bookings)
    .where(eq(bookings.id, parsed.bookingId))
    .limit(1);
  if (!b || b.code !== parsed.code) return { valid: false, verdict: 'NOT_FOUND' as TicketVerdict };
  if (b.status !== 'CONFIRMED') return { valid: false, verdict: 'NOT_CONFIRMED' as TicketVerdict, status: b.status };
  if (!checkIn) {
    return b.checkedInAt
      ? { valid: false, verdict: 'ALREADY_CHECKED_IN' as TicketVerdict, checkedInAt: b.checkedInAt.toISOString() }
      : { valid: true, verdict: 'VALID' as TicketVerdict, code: b.code, seatCount: b.seatCount };
  }
  // One conditional UPDATE: two gates scanning the same ticket cannot both admit it.
  const [admitted] = await db()
    .update(bookings)
    .set({ checkedInAt: sql`now()` })
    .where(and(eq(bookings.id, b.id), eq(bookings.status, 'CONFIRMED'), sql`${bookings.checkedInAt} IS NULL`))
    .returning({ checkedInAt: bookings.checkedInAt });
  if (!admitted) {
    const [again] = await db().select({ checkedInAt: bookings.checkedInAt }).from(bookings).where(eq(bookings.id, b.id));
    return { valid: false, verdict: 'ALREADY_CHECKED_IN' as TicketVerdict, checkedInAt: again?.checkedInAt?.toISOString() ?? null };
  }
  return { valid: true, verdict: 'VALID' as TicketVerdict, code: b.code, seatCount: b.seatCount, checkedInAt: admitted.checkedInAt!.toISOString() };
}
