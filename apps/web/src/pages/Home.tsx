import clsx from 'clsx';
import { ChevronRight, Play, Star } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { FORMATS, type MovieSummary } from '@cinebook/shared';
import { MovieCard, MovieCardSkeleton } from '../components/MovieCard';
import { EmptyState } from '../components/States';
import { useCity } from '../lib/city';
import { backdropUrl, fmtRuntime } from '../lib/format';
import { useMovies } from '../lib/queries';

function Hero({ movie }: { movie: MovieSummary }) {
  const bg = backdropUrl(movie.backdropPath);
  return (
    <section className="relative overflow-hidden bg-ink-2 text-white">
      {bg && <img src={bg} alt="" className="absolute inset-0 h-full w-full object-cover opacity-40" fetchPriority="high" />}
      <div
        className={clsx(
          'absolute inset-0',
          bg ? 'bg-gradient-to-r from-ink-2 via-ink-2/80 to-transparent' : 'bg-gradient-to-r from-ink-2 to-brand/60',
        )}
      />
      <div className="container-page relative py-10 md:py-16">
        <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-brand">Top pick this week</p>
        <h1 className="max-w-2xl text-3xl font-bold md:text-5xl">{movie.title}</h1>
        <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-white/80">
          {movie.rating && (
            <span className="flex items-center gap-1">
              <Star className="h-4 w-4 fill-brand text-brand" aria-hidden /> {movie.rating.toFixed(1)}/10
            </span>
          )}
          {movie.certificate && <span className="rounded border border-white/40 px-1.5 text-xs">{movie.certificate}</span>}
          <span>{movie.genres.slice(0, 3).join(', ')}</span>
          {fmtRuntime(movie.runtimeMin) && <span>{fmtRuntime(movie.runtimeMin)}</span>}
        </p>
        <div className="mt-6 flex gap-3">
          <Link to={`/movies/${movie.id}/showtimes`} className="btn-primary px-6">
            Book tickets
          </Link>
          <Link to={`/movies/${movie.id}`} className="btn border border-white/40 text-white hover:bg-white/10">
            <Play className="h-4 w-4" aria-hidden /> Details
          </Link>
        </div>
      </div>
    </section>
  );
}

function FilterRow({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly string[];
  value: string | undefined;
  onChange: (v: string | undefined) => void;
}) {
  if (!options.length) return null;
  return (
    <div className="flex items-center gap-2" role="group" aria-label={label}>
      <span className="w-20 shrink-0 text-xs font-medium uppercase tracking-wide text-ink-muted">{label}</span>
      <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
        {options.map((o) => (
          <button
            key={o}
            onClick={() => onChange(value === o ? undefined : o)}
            className={clsx('chip whitespace-nowrap', value === o && 'chip-active')}
            aria-pressed={value === o}
          >
            {o}
          </button>
        ))}
      </div>
    </div>
  );
}

function Grid({ movies, loading, eager = false }: { movies: MovieSummary[] | undefined; loading: boolean; eager?: boolean }) {
  if (loading && !movies) {
    return (
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <MovieCardSkeleton key={i} />
        ))}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
      {movies?.map((m, i) => <MovieCard key={m.id} movie={m} eager={eager && i < 5} />)}
    </div>
  );
}

export default function Home() {
  const { city } = useCity();
  const [lang, setLang] = useState<string>();
  const [genre, setGenre] = useState<string>();
  const [format, setFormat] = useState<string>();

  // Unfiltered list for the hero + filter options; filtered list for the grid.
  const base = useMovies({ status: 'now_showing', city: city?.id }, !!city);
  const filtered = useMovies({ status: 'now_showing', city: city?.id, lang, genre, format }, !!city);
  const upcoming = useMovies({ status: 'upcoming' });

  const { langs, genres } = useMemo(() => {
    const l = new Set<string>();
    const g = new Set<string>();
    base.data?.forEach((m) => {
      m.languages.forEach((x) => l.add(x));
      m.genres.forEach((x) => g.add(x));
    });
    return { langs: [...l].sort(), genres: [...g].sort() };
  }, [base.data]);

  const hero = base.data?.[0];
  const anyFilter = lang || genre || format;

  return (
    <>
      {hero ? <Hero movie={hero} /> : <div className="h-48 animate-pulse bg-ink-2 md:h-64" />}

      <div className="container-page mt-8 space-y-12">
        <section aria-labelledby="now-showing">
          <div className="mb-4 flex items-end justify-between gap-4">
            <div>
              <h2 id="now-showing" className="text-2xl font-bold">
                Now Showing
              </h2>
              <p className="text-sm text-ink-muted">{city ? `In cinemas across ${city.name}` : 'Loading city…'}</p>
            </div>
            {anyFilter && (
              <button
                className="text-sm font-medium text-brand"
                onClick={() => {
                  setLang(undefined);
                  setGenre(undefined);
                  setFormat(undefined);
                }}
              >
                Clear filters
              </button>
            )}
          </div>
          <div className="mb-6 space-y-2">
            <FilterRow label="Language" options={langs} value={lang} onChange={setLang} />
            <FilterRow label="Genre" options={genres} value={genre} onChange={setGenre} />
            <FilterRow label="Format" options={FORMATS} value={format} onChange={setFormat} />
          </div>
          {filtered.data?.length === 0 ? (
            <EmptyState title="No movies match these filters">Try another language, genre or format.</EmptyState>
          ) : (
            <div className={clsx(filtered.isPlaceholderData && 'opacity-60 transition')}>
              <Grid movies={filtered.data} loading={filtered.isLoading} eager />
            </div>
          )}
        </section>

        <section aria-labelledby="coming-soon" className="rounded-2xl bg-ink-2 p-5 text-white md:p-8">
          <div className="mb-4 flex items-center justify-between">
            <h2 id="coming-soon" className="text-2xl font-bold">
              Coming Soon
            </h2>
            <span className="flex items-center text-sm text-white/70">
              Explore upcoming <ChevronRight className="h-4 w-4" aria-hidden />
            </span>
          </div>
          <div className="[&_h3]:text-white [&_p]:text-white/60">
            {upcoming.data?.length === 0 ? (
              <p className="text-white/70">Nothing announced yet.</p>
            ) : (
              <Grid movies={upcoming.data} loading={upcoming.isLoading} />
            )}
          </div>
        </section>
      </div>
    </>
  );
}
