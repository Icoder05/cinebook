import { createHash, randomBytes } from 'node:crypto';
import type { CookieOptions, Response } from 'express';
import jwt from 'jsonwebtoken';
import { cookieSecure, env } from '../env.js';

export const ACCESS_TTL_SECONDS = 15 * 60;
export const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const REFRESH_COOKIE = 'cb_rt';

export interface AccessClaims {
  sub: string;
  role: 'customer' | 'admin';
  sid: string;
}

export function signAccessToken(claims: AccessClaims): string {
  return jwt.sign({ role: claims.role, sid: claims.sid }, env.JWT_ACCESS_SECRET, {
    algorithm: 'HS256',
    subject: claims.sub,
    expiresIn: ACCESS_TTL_SECONDS,
    issuer: 'cinebook',
  });
}

export type VerifyResult =
  | { ok: true; claims: AccessClaims }
  | { ok: false; reason: 'expired' | 'invalid' };

export function verifyAccessToken(token: string): VerifyResult {
  try {
    const p = jwt.verify(token, env.JWT_ACCESS_SECRET, {
      algorithms: ['HS256'],
      issuer: 'cinebook',
    }) as jwt.JwtPayload;
    if (typeof p.sub !== 'string' || typeof p.sid !== 'string') return { ok: false, reason: 'invalid' };
    if (p.role !== 'customer' && p.role !== 'admin') return { ok: false, reason: 'invalid' };
    return { ok: true, claims: { sub: p.sub, sid: p.sid, role: p.role } };
  } catch (err) {
    return { ok: false, reason: err instanceof jwt.TokenExpiredError ? 'expired' : 'invalid' };
  }
}

/** 32 random bytes; only the SHA-256 hash is stored. */
export function newRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

const cookieBase: CookieOptions = {
  httpOnly: true,
  secure: cookieSecure,
  sameSite: 'lax',
  path: '/api/v1/auth',
};

export function setRefreshCookie(res: Response, token: string) {
  res.cookie(REFRESH_COOKIE, token, { ...cookieBase, maxAge: REFRESH_TTL_MS });
}

export function clearRefreshCookie(res: Response) {
  res.clearCookie(REFRESH_COOKIE, cookieBase);
}
