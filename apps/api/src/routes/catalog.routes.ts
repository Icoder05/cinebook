import { Router } from 'express';
import { holdSchema, idParam, movieShowtimesQuerySchema, moviesQuerySchema } from '@cinebook/shared';
import { ah, parse } from '../lib/http.js';
import { optionalAuth, requireAuth } from '../middleware/auth.js';
import * as booking from '../services/booking.service.js';
import * as catalog from '../services/catalog.service.js';

export const catalogRouter = Router();

catalogRouter.get(
  '/cities',
  ah(async (_req, res) => {
    res.set('Cache-Control', 'public, max-age=300');
    res.json({ cities: await catalog.listCities() });
  }),
);

catalogRouter.get(
  '/movies',
  ah(async (req, res) => {
    const q = parse(moviesQuerySchema, req.query);
    res.set('Cache-Control', 'public, max-age=60');
    res.json(await catalog.listMovies(q));
  }),
);

catalogRouter.get(
  '/movies/:id',
  ah(async (req, res) => {
    const { id } = parse(idParam, req.params);
    res.set('Cache-Control', 'public, max-age=60');
    res.json(await catalog.getMovie(id));
  }),
);

catalogRouter.get(
  '/movies/:id/showtimes',
  ah(async (req, res) => {
    const { id } = parse(idParam, req.params);
    const q = parse(movieShowtimesQuerySchema, req.query);
    res.json(await catalog.getMovieShowtimes(id, q.city, q.date));
  }),
);

catalogRouter.get(
  '/showtimes/:id/seats',
  optionalAuth,
  ah(async (req, res) => {
    const { id } = parse(idParam, req.params);
    res.set('Cache-Control', 'no-store');
    res.json(await catalog.getSeatMap(id, req.user?.id ?? null));
  }),
);

catalogRouter.post(
  '/showtimes/:id/holds',
  requireAuth,
  ah(async (req, res) => {
    const { id } = parse(idParam, req.params);
    const { seatIds } = parse(holdSchema, req.body);
    res.status(201).json(await booking.createHold(req.user!.id, id, seatIds));
  }),
);

catalogRouter.delete(
  '/holds/:id',
  requireAuth,
  ah(async (req, res) => {
    const { id } = parse(idParam, req.params);
    await booking.releaseHold(req.user!.id, id);
    res.status(204).end();
  }),
);
