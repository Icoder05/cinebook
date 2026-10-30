import { Router } from 'express';
import {
  adminBookingsQuerySchema,
  adminShowtimesQuerySchema,
  autoScheduleSchema,
  idParam,
  screenSchema,
  showtimeSchema,
  theatreSchema,
  theatreUpdateSchema,
  ticketVerifySchema,
  uuid,
} from '@cinebook/shared';
import { z } from 'zod';
import { db } from '../db/client.js';
import { ah, parse } from '../lib/http.js';
import { requireAdmin } from '../middleware/auth.js';
import * as admin from '../services/admin.service.js';
import { verifyTicket } from '../services/booking.service.js';
import { syncMoviesFromTmdb } from '../services/tmdb.service.js';
import { autoSchedule, createScreen, createShowtime } from '../services/venue.service.js';

export const adminRouter = Router();
adminRouter.use(...requireAdmin);

adminRouter.get(
  '/stats',
  ah(async (_req, res) => {
    res.json(await admin.stats());
  }),
);

adminRouter.post(
  '/movies/sync',
  ah(async (_req, res) => {
    res.json(await syncMoviesFromTmdb());
  }),
);

// Theatres
adminRouter.get(
  '/theatres',
  ah(async (_req, res) => {
    res.json({ theatres: await admin.listTheatres() });
  }),
);
adminRouter.post(
  '/theatres',
  ah(async (req, res) => {
    res.status(201).json({ theatre: await admin.createTheatre(parse(theatreSchema, req.body)) });
  }),
);
adminRouter.patch(
  '/theatres/:id',
  ah(async (req, res) => {
    const { id } = parse(idParam, req.params);
    res.json({ theatre: await admin.updateTheatre(id, parse(theatreUpdateSchema, req.body)) });
  }),
);
adminRouter.delete(
  '/theatres/:id',
  ah(async (req, res) => {
    await admin.deleteTheatre(parse(idParam, req.params).id);
    res.status(204).end();
  }),
);

// Screens (seat layout + pricing tiers are created together)
adminRouter.get(
  '/screens',
  ah(async (req, res) => {
    const { theatreId } = parse(z.object({ theatreId: uuid.optional() }), req.query);
    res.json({ screens: await admin.listScreens(theatreId) });
  }),
);
adminRouter.post(
  '/screens',
  ah(async (req, res) => {
    const spec = parse(screenSchema, req.body);
    const screen = await db().transaction((tx) => createScreen(tx, spec));
    res.status(201).json({ screen });
  }),
);
adminRouter.delete(
  '/screens/:id',
  ah(async (req, res) => {
    await admin.deleteScreen(parse(idParam, req.params).id);
    res.status(204).end();
  }),
);

// Showtimes
adminRouter.get(
  '/showtimes',
  ah(async (req, res) => {
    res.json(await admin.listShowtimes(parse(adminShowtimesQuerySchema, req.query)));
  }),
);
adminRouter.post(
  '/showtimes',
  ah(async (req, res) => {
    res.status(201).json({ showtime: await createShowtime(parse(showtimeSchema, req.body)) });
  }),
);
adminRouter.post(
  '/showtimes/auto-schedule',
  ah(async (req, res) => {
    const { days } = parse(autoScheduleSchema, req.body ?? {});
    res.json(await autoSchedule(days));
  }),
);
adminRouter.post(
  '/showtimes/:id/cancel',
  ah(async (req, res) => {
    await admin.cancelShowtime(parse(idParam, req.params).id);
    res.status(204).end();
  }),
);

// Bookings
adminRouter.get(
  '/bookings',
  ah(async (req, res) => {
    res.json(await admin.listAllBookings(parse(adminBookingsQuerySchema, req.query)));
  }),
);

// Venue staff: scan a QR ticket → verify signature, status, and check in once.
adminRouter.post(
  '/tickets/verify',
  ah(async (req, res) => {
    const { payload, checkIn } = parse(ticketVerifySchema, req.body);
    res.json(await verifyTicket(payload, checkIn));
  }),
);
