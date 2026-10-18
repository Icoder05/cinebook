export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new AppError(400, 'BAD_REQUEST', message, details);
export const unauthorized = (message = 'Please sign in to continue', code = 'UNAUTHORIZED') =>
  new AppError(401, code, message);
export const forbidden = (message = 'You do not have access to this resource') =>
  new AppError(403, 'FORBIDDEN', message);
export const notFound = (what = 'Resource') => new AppError(404, 'NOT_FOUND', `${what} not found`);
export const conflict = (code: string, message: string, details?: unknown) =>
  new AppError(409, code, message, details);

/** Postgres SQLSTATE codes we translate into domain errors. */
export const PG = {
  uniqueViolation: '23505',
  foreignKeyViolation: '23503',
  exclusionViolation: '23P01',
  serializationFailure: '40001',
  deadlockDetected: '40P01',
} as const;

export function pgCode(err: unknown): string | undefined {
  let e: unknown = err;
  // Drizzle may wrap driver errors; walk the cause chain.
  for (let i = 0; i < 4 && e && typeof e === 'object'; i++) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code;
    e = (e as { cause?: unknown }).cause;
  }
  return undefined;
}
