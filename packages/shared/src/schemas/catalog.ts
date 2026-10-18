import { z } from 'zod';
import { FORMATS, MOVIE_STATUSES } from '../constants';
import { dateStr, uuid } from './common';

export const moviesQuerySchema = z.object({
  status: z.enum(MOVIE_STATUSES).optional(),
  city: uuid.optional(),
  lang: z.string().trim().min(1).max(40).optional(),
  genre: z.string().trim().min(1).max(40).optional(),
  format: z.enum(FORMATS).optional(),
  q: z.string().trim().min(1).max(80).optional(),
  limit: z.coerce.number().int().min(1).max(60).default(40),
});
export type MoviesQuery = z.infer<typeof moviesQuerySchema>;

export const movieShowtimesQuerySchema = z.object({
  city: uuid,
  date: dateStr.optional(),
});
export type MovieShowtimesQuery = z.infer<typeof movieShowtimesQuerySchema>;
