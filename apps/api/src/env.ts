import 'dotenv/config';
import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  /** Neon pooled connection string. Unset → embedded PGlite in .data/pglite (local dev only). */
  DATABASE_URL: z.string().optional(),
  /** pg pool size per process; serverless instances should keep this small. */
  DB_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
  JWT_ACCESS_SECRET: z
    .string()
    .min(32)
    .default('dev-only-insecure-secret-change-me-0123456789abcdef'),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  COOKIE_SECURE: bool.optional(),
  TRUST_PROXY: z.coerce.number().int().default(1),
  TMDB_API_KEY: z.string().optional(),
  BCRYPT_COST: z.coerce.number().int().min(4).max(15).default(12),
  HOLD_MINUTES: z.coerce.number().int().min(1).max(30).default(10),
  PAYMENT_DELAY_MS: z.coerce.number().int().min(0).default(1500),
  /** How long the "…1111" card stalls before answering, so the client times out. */
  PAYMENT_TIMEOUT_DELAY_MS: z.coerce.number().int().min(0).default(20_000),
  SWEEPER_INTERVAL_MS: z.coerce.number().int().min(0).default(60_000),
  /** Where the website runs in dev (Vite). The API's "/" redirects here. */
  WEB_URL: z.string().url().default('http://localhost:5173'),
  /** Override the built SPA location; by default apps/web/dist is served if it exists. */
  WEB_DIST: z.string().optional(),
  /** Serve the built website from this server too (always on in production; `npm start` sets it). */
  SERVE_WEB: bool.optional(),
  /** Seed demo data on boot when the database is empty (any driver). */
  SEED_ON_BOOT: bool.optional(),
  /**
   * Allow the embedded PGlite database in production — a zero-setup demo deploy.
   * Data lives on the instance's disk and is lost on redeploys/restarts; use Neon for real.
   */
  ALLOW_EMBEDDED_DB: bool.optional(),
  /** Set automatically by Render; added to the CORS allow-list. */
  RENDER_EXTERNAL_URL: z.string().optional(),
  ADMIN_EMAIL: z.string().email().default('admin@cinebook.dev'),
  ADMIN_PASSWORD: z.string().min(8).default('Admin@12345'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}
export const env = parsed.data;

if (env.NODE_ENV === 'production') {
  if (env.JWT_ACCESS_SECRET.startsWith('dev-only')) {
    throw new Error('JWT_ACCESS_SECRET must be set in production');
  }
  if (!env.DATABASE_URL && !env.ALLOW_EMBEDDED_DB) {
    throw new Error('DATABASE_URL must be set in production (or ALLOW_EMBEDDED_DB=true for a throwaway demo)');
  }
}

export const corsOrigins = [env.CORS_ORIGINS, env.RENDER_EXTERNAL_URL ?? '']
  .join(',')
  .split(',')
  .map((s) => s.trim().replace(/\/$/, ''))
  .filter(Boolean);
export const cookieSecure = env.COOKIE_SECURE ?? env.NODE_ENV === 'production';
