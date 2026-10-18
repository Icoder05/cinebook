import clsx from 'clsx';
import { Info, MapPin } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import type { ShowtimeChip } from '@cinebook/shared';
import { EmptyState, ErrorState, PageSpinner } from '../components/States';
import { useCity } from '../lib/city';
import { dayParts, fmtRuntime, fmtTime } from '../lib/format';
import { useShowtimes } from '../lib/queries';

const CHIP: Record<ShowtimeChip['availability'], string> = {
  AVAILABLE: 'border-emerald-500 text-emerald-700 hover:bg-emerald-50',
  FILLING_FAST: 'border-amber-500 text-amber-700 hover:bg-amber-50',
  SOLD_OUT: 'border-gray-300 text-gray-400 cursor-not-allowed',
};
const CHIP_LABEL: Record<ShowtimeChip['availability'], string> = {
  AVAILABLE: 'Available',
  FILLING_FAST: 'Filling fast',
  SOLD_OUT: 'Sold out',
};

export default function Showtimes() {
  const { id } = useParams();
  const { city } = useCity();
  const [params, setParams] = useSearchParams();
  const date = params.get('date') ?? undefined;
  const { data, isLoading, error, isPlaceholderData } = useShowtimes(id, city?.id, date);
  const [format, setFormat] = useState<string>();
  const [lang, setLang] = useState<string>();

  const { formats, langs } = useMemo(() => {
    const f = new Set<string>();
    const l = new Set<string>();
    data?.theatres.forEach((t) => t.showtimes.forEach((s) => (f.add(s.format), l.add(s.language))));
    return { formats: [...f], langs: [...l] };
  }, [data]);

  if (isLoading || !city) return <PageSpinner />;
  if (error || !data) return <ErrorState error={error} />;

  const theatres = data.theatres
    .map((t) => ({
      ...t,
      showtimes: t.showtimes.filter((s) => (!format || s.format === format) && (!lang || s.language === lang)),
    }))
    .filter((t) => t.showtimes.length);

  return (
    <>
      <div className="border-b bg-white">
        <div className="container-page py-5">
          <h1 className="text-2xl font-bold md:text-3xl">
            <Link to={`/movies/${data.movie.id}`} className="hover:text-brand">
              {data.movie.title}
            </Link>
          </h1>
          <p className="mt-1 flex flex-wrap gap-2 text-sm text-ink-muted">
            {data.movie.certificate && <span className="rounded border px-1.5">{data.movie.certificate}</span>}
            {data.movie.genres.map((g) => (
              <span key={g} className="rounded-full border px-2">
                {g}
              </span>
            ))}
            {fmtRuntime(data.movie.runtimeMin) && <span>{fmtRuntime(data.movie.runtimeMin)}</span>}
          </p>
        </div>
      </div>

      <div className="sticky top-[100px] z-20 border-b bg-white shadow-sm md:top-16">
        <div className="container-page flex flex-col gap-3 py-3 md:flex-row md:items-center md:justify-between">
          <nav className="no-scrollbar flex gap-2 overflow-x-auto" aria-label="Choose date">
            {data.dates.map((d) => {
              const p = dayParts(d.date);
              const active = d.date === data.date;
              return (
                <button
                  key={d.date}
                  disabled={!d.hasShows}
                  onClick={() => setParams({ date: d.date }, { replace: true })}
                  aria-pressed={active}
                  aria-label={`${p.weekday} ${p.day} ${p.month}${d.hasShows ? '' : ', no shows'}`}
                  className={clsx(
                    'flex w-14 shrink-0 flex-col items-center rounded-lg py-1.5 text-xs transition',
                    active ? 'bg-brand text-white' : 'hover:bg-surface',
                    !d.hasShows && 'cursor-not-allowed opacity-40',
                  )}
                >
                  <span>{p.weekday}</span>
                  <span className="text-lg font-semibold leading-tight">{p.day}</span>
                  <span>{p.month}</span>
                </button>
              );
            })}
          </nav>
          <div className="flex flex-wrap gap-2">
            <select
              value={lang ?? ''}
              onChange={(e) => setLang(e.target.value || undefined)}
              className="input w-auto py-1.5"
              aria-label="Filter by language"
            >
              <option value="">All languages</option>
              {langs.map((l) => (
                <option key={l}>{l}</option>
              ))}
            </select>
            <select
              value={format ?? ''}
              onChange={(e) => setFormat(e.target.value || undefined)}
              className="input w-auto py-1.5"
              aria-label="Filter by format"
            >
              <option value="">All formats</option>
              {formats.map((f) => (
                <option key={f}>{f}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className={clsx('container-page mt-6', isPlaceholderData && 'opacity-60')}>
        <div className="mb-3 flex flex-wrap items-center gap-4 text-xs text-ink-muted">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" /> Available
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-amber-500" /> Filling fast
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-gray-300" /> Sold out
          </span>
        </div>
        {theatres.length === 0 ? (
          <EmptyState title={`No shows in ${city.name} for this day`}>
            Try another date, format or language — or switch city from the header.
          </EmptyState>
        ) : (
          <ul className="card divide-y">
            {theatres.map((t) => (
              <li key={t.id} className="flex flex-col gap-3 p-4 md:flex-row md:gap-8 md:p-5">
                <div className="md:w-72 md:shrink-0">
                  <h2 className="font-semibold">{t.name}</h2>
                  <p className="mt-0.5 flex items-start gap-1 text-xs text-ink-muted">
                    <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> {t.address}
                  </p>
                  {t.amenities.length > 0 && (
                    <p className="mt-1 flex items-center gap-1 text-xs text-ink-muted">
                      <Info className="h-3.5 w-3.5" aria-hidden /> {t.amenities.slice(0, 3).join(' · ')}
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap gap-3">
                  {t.showtimes.map((s) => {
                    const label = `${fmtTime(s.startsAt)}, ${s.format}, ${s.language}, ${s.screenName}: ${CHIP_LABEL[s.availability]}`;
                    const inner = (
                      <>
                        <span className="text-sm font-medium">{fmtTime(s.startsAt)}</span>
                        <span className="text-[10px] uppercase tracking-wide opacity-80">
                          {s.format} · {s.language}
                        </span>
                      </>
                    );
                    return s.availability === 'SOLD_OUT' ? (
                      <span
                        key={s.id}
                        aria-label={label}
                        className={clsx('flex min-w-[96px] flex-col items-center rounded-lg border px-3 py-1.5', CHIP[s.availability])}
                      >
                        {inner}
                      </span>
                    ) : (
                      <Link
                        key={s.id}
                        to={`/showtimes/${s.id}/seats`}
                        aria-label={label}
                        title={`${s.screenName} · ${s.available} of ${s.total} seats left`}
                        className={clsx(
                          'flex min-w-[96px] flex-col items-center rounded-lg border px-3 py-1.5 transition',
                          CHIP[s.availability],
                        )}
                      >
                        {inner}
                      </Link>
                    );
                  })}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
