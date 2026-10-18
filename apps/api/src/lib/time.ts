import { IST_OFFSET_MINUTES } from '@cinebook/shared';

const OFFSET_MS = IST_OFFSET_MINUTES * 60_000;

/** YYYY-MM-DD of an instant, in India Standard Time. */
export function istDate(d: Date): string {
  return new Date(d.getTime() + OFFSET_MS).toISOString().slice(0, 10);
}

/** [start, end) of an IST calendar day as UTC instants. */
export function istDayBounds(date: string): { start: Date; end: Date } {
  const start = new Date(`${date}T00:00:00+05:30`);
  return { start, end: new Date(start.getTime() + 86_400_000) };
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** An IST wall-clock time on a given IST date, e.g. istAt('2026-10-17', 20, 30). */
export function istAt(date: string, hour: number, minute = 0): Date {
  const hh = String(hour).padStart(2, '0');
  const mm = String(minute).padStart(2, '0');
  return new Date(`${date}T${hh}:${mm}:00+05:30`);
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
