import { and, eq, gt, isNull } from 'drizzle-orm';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { db } from '../db/client.js';
import { sessions } from '../db/schema.js';
import { forbidden, unauthorized } from '../lib/errors.js';
import { ah } from '../lib/http.js';
import { type AccessClaims, verifyAccessToken } from '../lib/tokens.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: { id: string; role: AccessClaims['role']; sid: string };
    }
  }
}

function bearer(req: Request): string | null {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) return null;
  return h.slice(7).trim() || null;
}

/** Attaches req.user when a valid token is present; never rejects. */
export const optionalAuth: RequestHandler = (req, _res, next) => {
  const token = bearer(req);
  if (token) {
    const r = verifyAccessToken(token);
    if (r.ok) req.user = { id: r.claims.sub, role: r.claims.role, sid: r.claims.sid };
  }
  next();
};

/** Signature + expiry only — no DB hit, so read APIs stay fast. */
export const requireAuth: RequestHandler = (req: Request, _res: Response, next: NextFunction) => {
  const token = bearer(req);
  if (!token) return next(unauthorized());
  const r = verifyAccessToken(token);
  if (!r.ok) {
    return next(
      r.reason === 'expired'
        ? unauthorized('Your session token expired', 'TOKEN_EXPIRED')
        : unauthorized('Invalid access token', 'TOKEN_INVALID'),
    );
  }
  req.user = { id: r.claims.sub, role: r.claims.role, sid: r.claims.sid };
  next();
};

/** For sensitive routes (pay, cancel): the session row must still be live. */
export const requireSession: RequestHandler[] = [
  requireAuth,
  ah(async (req, _res, next) => {
    const [row] = await db()
      .select({ id: sessions.id })
      .from(sessions)
      .where(
        and(
          eq(sessions.id, req.user!.sid),
          eq(sessions.userId, req.user!.id),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, new Date()),
        ),
      )
      .limit(1);
    if (!row) throw unauthorized('This session has been signed out', 'SESSION_REVOKED');
    next();
  }),
];

export const requireAdmin: RequestHandler[] = [
  requireAuth,
  (req, _res, next) => next(req.user?.role === 'admin' ? undefined : forbidden('Admins only')),
];
