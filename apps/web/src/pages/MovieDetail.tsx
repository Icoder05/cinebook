import { CalendarDays, Clock, Play, Star, UserRound, X } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Poster } from '../components/Poster';
import { ErrorState, PageSpinner } from '../components/States';
import { backdropUrl, fmtRuntime, profileUrl } from '../lib/format';
import { useMovie } from '../lib/queries';

export default function MovieDetail() {
  const { id } = useParams();
  const { data: movie, isLoading, error } = useMovie(id);
  const [trailer, setTrailer] = useState(false);

  if (isLoading) return <PageSpinner />;
  if (error || !movie) return <ErrorState error={error} />;

  const bg = backdropUrl(movie.backdropPath);
  const upcoming = movie.status === 'upcoming';

  return (
    <>
      <section className="relative overflow-hidden bg-ink-2 text-white">
        {bg && <img src={bg} alt="" className="absolute inset-0 h-full w-full object-cover opacity-30" />}
        <div className="absolute inset-0 bg-gradient-to-r from-ink-2 via-ink-2/90 to-ink-2/40" />
        <div className="container-page relative flex flex-col gap-6 py-8 md:flex-row md:items-center md:gap-10 md:py-12">
          <div className="relative w-40 shrink-0 self-center md:w-64 md:self-auto">
            <Poster path={movie.posterPath} title={movie.title} size="w500" eager className="shadow-2xl" />
            {movie.trailerKey && (
              <button
                onClick={() => setTrailer(true)}
                className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-2 rounded-full bg-black/70 px-4 py-2 text-sm font-medium hover:bg-black/90"
              >
                <Play className="h-4 w-4 fill-white" aria-hidden /> Trailer
              </button>
            )}
          </div>
          <div className="min-w-0">
            <h1 className="text-3xl font-bold md:text-4xl">{movie.title}</h1>
            {movie.rating ? (
              <div className="mt-4 inline-flex items-center gap-2 rounded-lg bg-white/10 px-4 py-2.5">
                <Star className="h-5 w-5 fill-brand text-brand" aria-hidden />
                <span className="text-lg font-semibold">{movie.rating.toFixed(1)}/10</span>
                <span className="text-sm text-white/70">TMDB rating</span>
              </div>
            ) : null}
            <div className="mt-4 flex flex-wrap gap-2">
              {movie.languages.map((l) => (
                <span key={l} className="rounded bg-white px-2 py-0.5 text-sm text-ink-2">
                  {l}
                </span>
              ))}
            </div>
            <p className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-white/90">
              {fmtRuntime(movie.runtimeMin) && (
                <span className="flex items-center gap-1">
                  <Clock className="h-4 w-4" aria-hidden /> {fmtRuntime(movie.runtimeMin)}
                </span>
              )}
              <span>•</span>
              <span>{movie.genres.join(', ')}</span>
              {movie.certificate && (
                <>
                  <span>•</span>
                  <span className="rounded border border-white/50 px-1.5 text-sm">{movie.certificate}</span>
                </>
              )}
              {movie.releaseDate && (
                <>
                  <span>•</span>
                  <span className="flex items-center gap-1">
                    <CalendarDays className="h-4 w-4" aria-hidden />
                    {new Date(movie.releaseDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </span>
                </>
              )}
            </p>
            {upcoming ? (
              <p className="mt-6 inline-block rounded-lg bg-white/10 px-4 py-3 text-sm">
                Releasing soon — bookings open closer to release.
              </p>
            ) : (
              <Link to={`/movies/${movie.id}/showtimes`} className="btn-primary mt-6 px-10 py-3 text-base">
                Book tickets
              </Link>
            )}
          </div>
        </div>
      </section>

      <div className="container-page mt-8 space-y-10">
        {movie.overview && (
          <section>
            <h2 className="mb-2 text-xl font-bold">About the movie</h2>
            <p className="max-w-3xl leading-relaxed text-ink">{movie.overview}</p>
          </section>
        )}
        {movie.cast.length > 0 && (
          <section>
            <h2 className="mb-4 text-xl font-bold">Cast</h2>
            <ul className="no-scrollbar flex gap-6 overflow-x-auto pb-2">
              {movie.cast.map((c) => {
                const img = profileUrl(c.profilePath);
                return (
                  <li key={c.name + c.character} className="w-24 shrink-0 text-center">
                    <div className="mx-auto h-24 w-24 overflow-hidden rounded-full bg-gray-200">
                      {img ? (
                        <img src={img} alt={c.name} loading="lazy" className="h-full w-full object-cover" />
                      ) : (
                        <UserRound className="m-auto mt-5 h-14 w-14 text-gray-400" aria-hidden />
                      )}
                    </div>
                    <p className="mt-2 line-clamp-2 text-sm font-medium">{c.name}</p>
                    {c.character && <p className="line-clamp-2 text-xs text-ink-muted">as {c.character}</p>}
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </div>

      {trailer && movie.trailerKey && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={`${movie.title} trailer`}
          onClick={() => setTrailer(false)}
        >
          <button className="absolute right-4 top-4 text-white" aria-label="Close trailer">
            <X className="h-7 w-7" />
          </button>
          <div className="aspect-video w-full max-w-4xl">
            <iframe
              className="h-full w-full rounded-lg"
              src={`https://www.youtube-nocookie.com/embed/${movie.trailerKey}?autoplay=1`}
              title={`${movie.title} trailer`}
              allow="autoplay; encrypted-media; picture-in-picture"
              allowFullScreen
            />
          </div>
        </div>
      )}
    </>
  );
}
