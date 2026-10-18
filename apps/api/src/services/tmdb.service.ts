import { eq, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { castMembers, movies } from '../db/schema.js';
import { env } from '../env.js';
import { clearCache } from '../lib/cache.js';
import { AppError } from '../lib/errors.js';

const BASE = 'https://api.themoviedb.org/3';

interface TmdbListItem {
  id: number;
}
interface TmdbList {
  results: TmdbListItem[];
  total_pages: number;
}
interface TmdbDetail {
  id: number;
  title: string;
  overview: string;
  poster_path: string | null;
  backdrop_path: string | null;
  runtime: number | null;
  release_date: string;
  original_language: string;
  spoken_languages: { iso_639_1: string; english_name: string }[];
  genres: { id: number; name: string }[];
  vote_average: number;
  credits?: { cast: { name: string; character: string; profile_path: string | null; order: number }[] };
  videos?: { results: { key: string; site: string; type: string; official: boolean }[] };
  release_dates?: {
    results: { iso_3166_1: string; release_dates: { certification: string; type: number }[] }[];
  };
}

const LANG_NAMES: Record<string, string> = {
  hi: 'Hindi',
  en: 'English',
  te: 'Telugu',
  ta: 'Tamil',
  ml: 'Malayalam',
  kn: 'Kannada',
  mr: 'Marathi',
  bn: 'Bengali',
  pa: 'Punjabi',
  gu: 'Gujarati',
  ja: 'Japanese',
  ko: 'Korean',
  fr: 'French',
  es: 'Spanish',
};

async function tmdb<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const key = env.TMDB_API_KEY;
  if (!key) throw new AppError(503, 'TMDB_NOT_CONFIGURED', 'Set TMDB_API_KEY to sync movies from TMDB');
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const headers: Record<string, string> = { accept: 'application/json' };
  // v4 "API Read Access Token" is a JWT; the short v3 key goes in the query string.
  if (key.startsWith('eyJ')) headers.authorization = `Bearer ${key}`;
  else url.searchParams.set('api_key', key);

  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
    if (res.status === 429 && attempt < 3) {
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      continue;
    }
    if (!res.ok) {
      throw new AppError(502, 'TMDB_ERROR', `TMDB ${path} responded ${res.status}`);
    }
    return (await res.json()) as T;
  }
}

async function listIds(path: string, pages: number): Promise<number[]> {
  const ids: number[] = [];
  for (let page = 1; page <= pages; page++) {
    const r = await tmdb<TmdbList>(path, { region: 'IN', language: 'en-US', page: String(page) });
    ids.push(...r.results.map((m) => m.id));
    if (page >= r.total_pages) break;
  }
  return ids;
}

function languagesOf(d: TmdbDetail): string[] {
  const names = new Set<string>();
  const original =
    LANG_NAMES[d.original_language] ??
    d.spoken_languages.find((l) => l.iso_639_1 === d.original_language)?.english_name;
  if (original) names.add(original);
  for (const l of d.spoken_languages) {
    const n = LANG_NAMES[l.iso_639_1] ?? l.english_name;
    if (n) names.add(n);
  }
  return [...names].slice(0, 4);
}

function certificateOf(d: TmdbDetail): string | null {
  const india = d.release_dates?.results.find((r) => r.iso_3166_1 === 'IN');
  const cert = india?.release_dates.map((r) => r.certification.trim()).find(Boolean);
  return cert || null;
}

function trailerOf(d: TmdbDetail): string | null {
  const vids = (d.videos?.results ?? []).filter((v) => v.site === 'YouTube');
  const pick =
    vids.find((v) => v.type === 'Trailer' && v.official) ??
    vids.find((v) => v.type === 'Trailer') ??
    vids.find((v) => v.type === 'Teaser');
  return pick?.key ?? null;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

/** MOV-1: pull now-playing and upcoming (region IN) into `movies` + `cast_members`. */
export async function syncMoviesFromTmdb(pages = 2) {
  const [nowIds, upcomingIds] = await Promise.all([
    listIds('/movie/now_playing', pages),
    listIds('/movie/upcoming', pages),
  ]);
  const nowSet = new Set(nowIds);
  const all = [...new Set([...nowIds, ...upcomingIds])];

  let synced = 0;
  await mapLimit(all, 5, async (id) => {
    const d = await tmdb<TmdbDetail>(`/movie/${id}`, {
      language: 'en-US',
      append_to_response: 'credits,videos,release_dates',
    });
    const status = nowSet.has(id) ? 'now_showing' : 'upcoming';
    const row = {
      tmdbId: d.id,
      title: d.title,
      overview: d.overview || null,
      posterPath: d.poster_path,
      backdropPath: d.backdrop_path,
      runtimeMin: d.runtime || null,
      releaseDate: d.release_date || null,
      languages: languagesOf(d),
      genres: d.genres.map((g) => g.name),
      certificate: certificateOf(d),
      rating: d.vote_average ? Math.round(d.vote_average * 10) / 10 : null,
      trailerKey: trailerOf(d),
      status: status as 'now_showing' | 'upcoming',
      syncedAt: new Date(),
    };
    await db().transaction(async (tx) => {
      const [m] = await tx
        .insert(movies)
        .values(row)
        .onConflictDoUpdate({ target: movies.tmdbId, set: { ...row, tmdbId: sql`excluded.tmdb_id` } })
        .returning({ id: movies.id });
      await tx.delete(castMembers).where(eq(castMembers.movieId, m.id));
      const cast = (d.credits?.cast ?? []).sort((a, b) => a.order - b.order).slice(0, 10);
      if (cast.length) {
        await tx.insert(castMembers).values(
          cast.map((c, i) => ({
            movieId: m.id,
            name: c.name,
            character: c.character || null,
            profilePath: c.profile_path,
            orderNo: i,
          })),
        );
      }
    });
    synced++;
  });

  clearCache();
  return { nowShowing: nowIds.length, upcoming: upcomingIds.filter((i) => !nowSet.has(i)).length, synced };
}
