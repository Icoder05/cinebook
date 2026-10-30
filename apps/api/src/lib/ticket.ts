import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../env.js';

/**
 * Signed e-ticket payloads: CB1.<bookingId>.<code>.<signature>
 * The signature is an HMAC-SHA256 (truncated to 128 bits, base64url) over "<bookingId>.<code>",
 * keyed from the server secret, so a ticket cannot be forged or altered without the key.
 */
const PREFIX = 'CB1';
const key = () => createHmac('sha256', env.JWT_ACCESS_SECRET).update('cinebook:ticket:v1').digest();

function sign(bookingId: string, code: string): string {
  return createHmac('sha256', key()).update(`${bookingId}.${code}`).digest('base64url').slice(0, 22);
}

export function ticketPayload(bookingId: string, code: string): string {
  return `${PREFIX}.${bookingId}.${code}.${sign(bookingId, code)}`;
}

export type TicketCheck =
  | { ok: true; bookingId: string; code: string }
  | { ok: false; reason: 'MALFORMED' | 'BAD_SIGNATURE' };

export function verifyTicketPayload(payload: string): TicketCheck {
  const parts = payload.trim().split('.');
  if (parts.length !== 4 || parts[0] !== PREFIX) return { ok: false, reason: 'MALFORMED' };
  const [, bookingId, code, sig] = parts;
  if (!/^[0-9a-f-]{36}$/i.test(bookingId) || !/^CB[A-Z0-9]{6}$/.test(code)) return { ok: false, reason: 'MALFORMED' };
  const expected = Buffer.from(sign(bookingId, code));
  const given = Buffer.from(sig);
  // Constant-time comparison: no timing side channel on the signature.
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, reason: 'BAD_SIGNATURE' };
  return { ok: true, bookingId, code };
}
