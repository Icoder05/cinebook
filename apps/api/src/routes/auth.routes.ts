import { Router, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { loginSchema, signupSchema, updateProfileSchema } from '@cinebook/shared';
import { env } from '../env.js';
import { ah, parse } from '../lib/http.js';
import { clearRefreshCookie, REFRESH_COOKIE, setRefreshCookie } from '../lib/tokens.js';
import { requireAuth } from '../middleware/auth.js';
import * as auth from '../services/auth.service.js';

const meta = (req: Request): auth.ClientMeta => ({
  ip: req.ip,
  userAgent: req.get('user-agent') ?? undefined,
});

function sendSession(res: Response, status: number, s: auth.IssuedSession) {
  setRefreshCookie(res, s.refreshToken);
  res.status(status).json({ user: s.user, accessToken: s.accessToken });
}

/** AUTH-5: 5 failed attempts per 15 min per IP + email. */
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => `${req.ip}|${String(req.body?.email ?? '').trim().toLowerCase()}`,
  skip: () => env.NODE_ENV === 'test' && process.env.RATE_LIMIT_IN_TESTS !== '1',
  handler: (_req, res) => {
    res.status(429).json({
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many login attempts. Try again in 15 minutes.',
        details: {},
      },
    });
  },
});

export const authRouter = Router();

authRouter.post(
  '/signup',
  ah(async (req, res) => {
    const input = parse(signupSchema, req.body);
    sendSession(res, 201, await auth.signup(input, meta(req)));
  }),
);

authRouter.post(
  '/login',
  loginLimiter,
  ah(async (req, res) => {
    const input = parse(loginSchema, req.body);
    sendSession(res, 200, await auth.login(input, meta(req)));
  }),
);

authRouter.post(
  '/refresh',
  ah(async (req, res) => {
    try {
      sendSession(res, 200, await auth.refresh(req.cookies?.[REFRESH_COOKIE], meta(req)));
    } catch (err) {
      // A racing tab already holds the new cookie; don't wipe it.
      if (!(err instanceof Error && 'code' in err && err.code === 'REFRESH_RACE')) clearRefreshCookie(res);
      throw err;
    }
  }),
);

authRouter.post(
  '/logout',
  requireAuth,
  ah(async (req, res) => {
    await auth.logout(req.user!.sid);
    clearRefreshCookie(res);
    res.status(204).end();
  }),
);

authRouter.post(
  '/logout-all',
  requireAuth,
  ah(async (req, res) => {
    await auth.revokeAllForUser(req.user!.id);
    clearRefreshCookie(res);
    res.status(204).end();
  }),
);

export const meRouter = Router();

meRouter.get(
  '/',
  requireAuth,
  ah(async (req, res) => {
    res.json({ user: await auth.getUser(req.user!.id) });
  }),
);

meRouter.patch(
  '/',
  requireAuth,
  ah(async (req, res) => {
    const input = parse(updateProfileSchema, req.body);
    res.json({ user: await auth.updateProfile(req.user!.id, input) });
  }),
);
