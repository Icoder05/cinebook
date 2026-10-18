import { z } from 'zod';
import { BOOKING_STATUSES, FORMATS } from '../constants';
import { dateStr, uuid } from './common';

export const theatreSchema = z.object({
  cityId: uuid,
  name: z.string().trim().min(2).max(100),
  address: z.string().trim().min(2).max(300),
  lat: z.coerce.number().min(-90).max(90).optional().nullable(),
  lng: z.coerce.number().min(-180).max(180).optional().nullable(),
  amenities: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
});
export type TheatreInput = z.infer<typeof theatreSchema>;
export const theatreUpdateSchema = theatreSchema.partial();

const rowsCount = z.coerce.number().int().min(1).max(15);

/**
 * A screen is generated from a compact spec. Tiers are listed back-of-hall first
 * (usually the priciest); rows are lettered from the front (A is nearest the screen).
 */
export const screenSchema = z
  .object({
    theatreId: uuid,
    name: z.string().trim().min(1).max(60),
    cols: z.coerce.number().int().min(4).max(30),
    tiers: z
      .array(
        z.object({
          name: z.string().trim().min(1).max(30),
          pricePaise: z.coerce.number().int().min(0).max(10_000_00),
          rows: rowsCount,
        }),
      )
      .min(1)
      .max(5),
    aisles: z.array(z.coerce.number().int().min(1)).max(6).default([]),
    blocked: z
      .array(z.string().regex(/^[A-Z]{1,2}\d{1,2}$/, 'Use seat labels like A1'))
      .max(100)
      .default([]),
    formats: z.array(z.enum(FORMATS)).min(1).default(['2D']),
  })
  .refine((s) => s.tiers.reduce((n, t) => n + t.rows, 0) <= 26, {
    message: 'At most 26 rows in total',
    path: ['tiers'],
  })
  .refine((s) => s.aisles.every((a) => a < s.cols), {
    message: 'Aisles must be inside the row',
    path: ['aisles'],
  });
export type ScreenInput = z.infer<typeof screenSchema>;

export const showtimeSchema = z.object({
  movieId: uuid,
  screenId: uuid,
  startsAt: z.string().datetime({ offset: true }),
  language: z.string().trim().min(2).max(30),
  format: z.enum(FORMATS),
  priceOverrides: z.record(uuid, z.coerce.number().int().min(0)).default({}),
});
export type ShowtimeInput = z.infer<typeof showtimeSchema>;

export const adminShowtimesQuerySchema = z.object({
  date: dateStr.optional(),
  theatreId: uuid.optional(),
  movieId: uuid.optional(),
});

export const adminBookingsQuerySchema = z.object({
  status: z.enum(BOOKING_STATUSES).optional(),
  date: dateStr.optional(),
  q: z.string().trim().min(1).max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
});

export const autoScheduleSchema = z.object({
  days: z.coerce.number().int().min(1).max(14).default(7),
});
