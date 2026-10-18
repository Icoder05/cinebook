import { sweepExpiredHolds } from '../services/booking.service.js';

/** Marks lapsed holds AVAILABLE and their bookings EXPIRED. Purely for clean data. */
export function startSweeper(intervalMs: number) {
  if (intervalMs <= 0) return () => {};
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      const r = await sweepExpiredHolds();
      if (r.expiredBookings || r.releasedSeats) {
        console.log(`[sweeper] expired ${r.expiredBookings} bookings, released ${r.releasedSeats} seats`);
      }
    } catch (err) {
      console.error('[sweeper] failed', err);
    } finally {
      running = false;
    }
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
