import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import { sql } from 'drizzle-orm';
import express, { Router } from 'express';
import helmet from 'helmet';
import { db } from './db/client.js';
import { corsOrigins, env } from './env.js';
import { ah } from './lib/http.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';
import { adminRouter } from './routes/admin.routes.js';
import { authRouter, meRouter } from './routes/auth.routes.js';
import { bookingsRouter } from './routes/bookings.routes.js';
import { catalogRouter } from './routes/catalog.routes.js';

/**
 * The built SPA (apps/web/dist). Resolved relative to this file so it works both from
 * src/ under tsx and from the bundled dist/ — both sit two levels below apps/.
 */
const WEB_DIST = env.WEB_DIST ?? resolve(dirname(fileURLToPath(import.meta.url)), '../../web/dist');

export function createApp() {
  const app = express();
  app.set('trust proxy', env.TRUST_PROXY);
  app.disable('x-powered-by');
  app.set('etag', false);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com'],
          imgSrc: ["'self'", 'data:', 'https://image.tmdb.org'],
          connectSrc: ["'self'"],
          frameSrc: ['https://www.youtube-nocookie.com'],
          // The host (Render/HTTPS proxy) enforces HTTPS; this would break local prod tests.
          upgradeInsecureRequests: null,
        },
      },
    }),
  );
  app.use(
    cors({
      origin: (origin, cb) => cb(null, !origin || corsOrigins.includes(origin)),
      credentials: true,
      allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
    }),
  );
  app.use(compression());
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  const v1 = Router();
  v1.get('/', (_req, res) => {
    res.json({ name: 'CineBook API', version: 'v1', health: '/api/v1/health', docs: 'see README.md' });
  });
  v1.get(
    '/health',
    ah(async (_req, res) => {
      const t0 = performance.now();
      await db().execute(sql`SELECT 1`);
      res.set('Cache-Control', 'no-store');
      res.json({ ok: true, db: 'up', dbLatencyMs: Math.round(performance.now() - t0) });
    }),
  );
  v1.use('/auth', authRouter);
  v1.use('/me', meRouter);
  v1.use('/bookings', bookingsRouter);
  v1.use('/admin', adminRouter);
  v1.use('/', catalogRouter);
  app.use('/api/v1', v1);
  app.use('/api', notFoundHandler);

  if (webDistAvailable()) {
    // One service hosts everything: same origin for the SPA and the API, so the
    // SameSite=Lax refresh cookie needs no cross-site setup.
    app.use(
      express.static(WEB_DIST, {
        index: false,
        setHeaders: (res, path) => {
          // Vite fingerprints /assets, so they can be cached forever.
          if (path.includes(`${join('dist', 'assets')}`)) {
            res.set('Cache-Control', 'public, max-age=31536000, immutable');
          }
        },
      }),
    );
    app.get('*', (req, res, next) => {
      // Client-side routes get index.html; a missing file (/assets/x.js) is a real 404.
      if (/\.[a-z0-9]+$/i.test(req.path)) return next();
      res.set('Cache-Control', 'no-cache');
      res.sendFile(join(WEB_DIST, 'index.html'));
    });
  } else if (env.NODE_ENV !== 'production') {
    // Dev: the site is served by Vite. Send stray visitors there instead of a 404.
    app.get('/', (_req, res) => res.redirect(env.WEB_URL));
  }

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

/** Production and `npm start` serve the built SPA; `npm run dev` leaves that to Vite. */
export function webDistAvailable() {
  return (env.NODE_ENV === 'production' || !!env.SERVE_WEB) && existsSync(join(WEB_DIST, 'index.html'));
}
