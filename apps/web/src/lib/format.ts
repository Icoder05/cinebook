export { formatINR } from '@cinebook/shared';

const TZ = 'Asia/Kolkata';

export const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: TZ });

export const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: TZ });

export const fmtDateLong = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: TZ,
  });

export const fmtDateTime = (iso: string) => `${fmtDate(iso)}, ${fmtTime(iso)}`;

export function fmtRuntime(min: number | null | undefined) {
  if (!min) return null;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}

/** YYYY-MM-DD for a calendar date string, rendered as day parts. */
export function dayParts(date: string) {
  const d = new Date(`${date}T12:00:00+05:30`);
  return {
    weekday: d.toLocaleDateString('en-IN', { weekday: 'short', timeZone: TZ }).toUpperCase(),
    day: d.toLocaleDateString('en-IN', { day: '2-digit', timeZone: TZ }),
    month: d.toLocaleDateString('en-IN', { month: 'short', timeZone: TZ }).toUpperCase(),
  };
}

const IMG = 'https://image.tmdb.org/t/p';
export const posterUrl = (path: string | null, size: 'w185' | 'w342' | 'w500' = 'w342') =>
  path ? `${IMG}/${size}${path}` : null;
export const backdropUrl = (path: string | null) => (path ? `${IMG}/w780${path}` : null);
export const profileUrl = (path: string | null) => (path ? `${IMG}/w185${path}` : null);
