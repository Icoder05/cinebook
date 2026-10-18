import { Router } from 'express';
import { bookingsQuerySchema, idempotencyKeySchema, idParam, paySchema } from '@cinebook/shared';
import { AppError } from '../lib/errors.js';
import { ah, parse } from '../lib/http.js';
import { requireAuth, requireSession } from '../middleware/auth.js';
import * as booking from '../services/booking.service.js';

export const bookingsRouter = Router();

bookingsRouter.get(
  '/',
  requireAuth,
  ah(async (req, res) => {
    const { scope } = parse(bookingsQuerySchema, req.query);
    res.json({ bookings: await booking.listBookings(req.user!.id, scope) });
  }),
);

bookingsRouter.get(
  '/:id',
  requireAuth,
  ah(async (req, res) => {
    const { id } = parse(idParam, req.params);
    res.set('Cache-Control', 'no-store');
    res.json({ booking: await booking.getBooking(id, req.user!) });
  }),
);

bookingsRouter.post(
  '/:id/pay',
  ...requireSession,
  ah(async (req, res) => {
    const { id } = parse(idParam, req.params);
    const rawKey = req.get('Idempotency-Key');
    if (!rawKey) throw new AppError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required');
    const key = parse(idempotencyKeySchema, rawKey);
    const input = parse(paySchema, req.body);
    res.json(await booking.pay(req.user!.id, id, key, input));
  }),
);

bookingsRouter.post(
  '/:id/cancel',
  ...requireSession,
  ah(async (req, res) => {
    const { id } = parse(idParam, req.params);
    await booking.cancelBooking(req.user!.id, id);
    res.json({ booking: await booking.getBooking(id, req.user!) });
  }),
);
