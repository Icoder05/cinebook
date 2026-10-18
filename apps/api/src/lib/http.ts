import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ZodType, ZodTypeDef } from 'zod';
import { AppError } from './errors.js';

/** Express 4 doesn't forward rejected promises; this does. */
export const ah =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };

export function parse<T>(schema: ZodType<T, ZodTypeDef, unknown>, data: unknown): T {
  const r = schema.safeParse(data);
  if (!r.success) {
    const flat = r.error.flatten();
    const first =
      flat.formErrors[0] ??
      Object.entries(flat.fieldErrors)
        .map(([k, v]) => `${k}: ${(v as string[])[0]}`)
        .at(0) ??
      'Invalid request';
    throw new AppError(422, 'VALIDATION_ERROR', first, flat);
  }
  return r.data;
}
