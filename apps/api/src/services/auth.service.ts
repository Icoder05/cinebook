import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { LoginInput, SignupInput, UpdateProfileInput, User } from '@cinebook/shared';
import { db, type Executor } from '../db/client.js';
import { sessions, users } from '../db/schema.js';
import { env } from '../env.js';
import { AppError, conflict, notFound, PG, pgCode, unauthorized } from '../lib/errors.js';
import {
  hashToken,
  newRefreshToken,
  REFRESH_TTL_MS,
  signAccessToken,
} from '../lib/tokens.js';

export interface ClientMeta {
  ip?: string;
  userAgent?: string;
}

export interface IssuedSession {
  user: User;
  accessToken: string;
  refreshToken: string;
}

/** Concurrent tabs may race to rotate the same token; a reuse this soon is not theft. */
const ROTATION_GRACE_MS = 10_000;

type UserRow = typeof users.$inferSelect;

export function toUser(u: UserRow): User {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    phone: u.phone,
    role: u.role,
    createdAt: u.createdAt.toISOString(),
  };
}

async function issueSession(
  ex: Executor,
  user: UserRow,
  meta: ClientMeta,
  familyId: string = randomUUID(),
): Promise<IssuedSession> {
  const refreshToken = newRefreshToken();
  const [s] = await ex
    .insert(sessions)
    .values({
      userId: user.id,
      refreshTokenHash: hashToken(refreshToken),
      familyId,
      userAgent: meta.userAgent?.slice(0, 300) ?? null,
      ip: meta.ip ?? null,
      expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
    })
    .returning({ id: sessions.id });
  return {
    user: toUser(user),
    accessToken: signAccessToken({ sub: user.id, role: user.role, sid: s.id }),
    refreshToken,
  };
}

export async function signup(input: SignupInput, meta: ClientMeta): Promise<IssuedSession> {
  const passwordHash = await bcrypt.hash(input.password, env.BCRYPT_COST);
  try {
    return await db().transaction(async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({ name: input.name, email: input.email, phone: input.phone, passwordHash })
        .returning();
      return issueSession(tx, user, meta);
    });
  } catch (err) {
    if (pgCode(err) === PG.uniqueViolation) {
      throw conflict('EMAIL_TAKEN', 'An account with this email already exists');
    }
    throw err;
  }
}

// Compared against when the email is unknown, so response time doesn't leak which emails exist.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 4);

export async function login(input: LoginInput, meta: ClientMeta): Promise<IssuedSession> {
  const [user] = await db().select().from(users).where(eq(users.email, input.email)).limit(1);
  const ok = await bcrypt.compare(input.password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok) throw new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
  return issueSession(db(), user, meta);
}

/**
 * Rotation: the presented token is atomically claimed (revoked) and a new one is issued
 * in the same family. Presenting an already-rotated token outside the grace window is
 * treated as theft and revokes every session the user has.
 */
export async function refresh(token: string | undefined, meta: ClientMeta): Promise<IssuedSession> {
  if (!token) throw unauthorized('No refresh token', 'REFRESH_MISSING');
  const hash = hashToken(token);

  const result = await db().transaction(async (tx) => {
    const [claimed] = await tx
      .update(sessions)
      .set({ revokedAt: sql`now()`, revokedReason: 'rotated' })
      .where(
        and(
          eq(sessions.refreshTokenHash, hash),
          isNull(sessions.revokedAt),
          sql`${sessions.expiresAt} > now()`,
        ),
      )
      .returning();
    if (!claimed) return null;
    const [user] = await tx.select().from(users).where(eq(users.id, claimed.userId)).limit(1);
    if (!user) return null;
    return issueSession(tx, user, meta, claimed.familyId);
  });
  if (result) return result;

  const [existing] = await db()
    .select()
    .from(sessions)
    .where(eq(sessions.refreshTokenHash, hash))
    .limit(1);
  if (!existing) throw unauthorized('Invalid refresh token', 'REFRESH_INVALID');
  if (existing.revokedAt) {
    const sinceRevoked = Date.now() - existing.revokedAt.getTime();
    if (existing.revokedReason === 'rotated' && sinceRevoked < ROTATION_GRACE_MS) {
      throw unauthorized('Refresh already in progress', 'REFRESH_RACE');
    }
    if (existing.revokedReason === 'rotated') {
      await revokeAllForUser(existing.userId, 'reuse_detected');
      throw unauthorized('Refresh token reuse detected; all sessions signed out', 'REFRESH_REUSED');
    }
    throw unauthorized('Session has been signed out', 'REFRESH_REVOKED');
  }
  throw unauthorized('Session expired, please sign in again', 'REFRESH_EXPIRED');
}

export async function logout(sessionId: string) {
  await db()
    .update(sessions)
    .set({ revokedAt: sql`now()`, revokedReason: 'logout' })
    .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)));
}

export async function revokeAllForUser(userId: string, reason = 'logout_all') {
  await db()
    .update(sessions)
    .set({ revokedAt: sql`now()`, revokedReason: reason })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
}

export async function getUser(userId: string): Promise<User> {
  const [u] = await db().select().from(users).where(eq(users.id, userId)).limit(1);
  if (!u) throw notFound('User');
  return toUser(u);
}

export async function updateProfile(userId: string, input: UpdateProfileInput): Promise<User> {
  const [u] = await db().update(users).set(input).where(eq(users.id, userId)).returning();
  if (!u) throw notFound('User');
  return toUser(u);
}

/** Idempotent: used by the seed script. */
export async function ensureAdmin(email: string, password: string) {
  const passwordHash = await bcrypt.hash(password, env.BCRYPT_COST);
  await db()
    .insert(users)
    .values({ name: 'CineBook Admin', email: email.toLowerCase(), passwordHash, role: 'admin' })
    .onConflictDoUpdate({ target: users.email, set: { role: 'admin' } });
}
