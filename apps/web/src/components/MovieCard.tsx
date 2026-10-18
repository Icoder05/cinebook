import { Star } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { MovieSummary } from '@cinebook/shared';
import { Poster } from './Poster';

export function MovieCard({ movie, eager }: { movie: MovieSummary; eager?: boolean }) {
  const upcoming = movie.status === 'upcoming';
  return (
    <Link to={`/movies/${movie.id}`} className="group block w-full" aria-label={movie.title}>
      <div className="relative">
        <Poster
          path={movie.posterPath}
          title={movie.title}
          eager={eager}
          className="transition duration-200 group-hover:-translate-y-0.5 group-hover:shadow-lg"
        />
        <div className="absolute inset-x-0 bottom-0 rounded-b-lg bg-black px-2 py-1.5 text-xs font-medium text-white">
          {upcoming ? (
            <span>
              Releasing{' '}
              {movie.releaseDate
                ? new Date(movie.releaseDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
                : 'soon'}
            </span>
          ) : movie.rating ? (
            <span className="flex items-center gap-1">
              <Star className="h-3.5 w-3.5 fill-brand text-brand" aria-hidden />
              {movie.rating.toFixed(1)}/10
            </span>
          ) : movie.releaseDate ? (
            <span>
              In cinemas since{' '}
              {new Date(movie.releaseDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
            </span>
          ) : (
            <span>Now showing</span>
          )}
        </div>
      </div>
      <h3 className="mt-2 line-clamp-1 text-[15px] font-medium text-ink-2 group-hover:text-brand">{movie.title}</h3>
      <p className="line-clamp-1 text-sm text-ink-muted">{movie.genres.slice(0, 3).join('/')}</p>
    </Link>
  );
}

export function MovieCardSkeleton() {
  return (
    <div className="w-full">
      <div className="skeleton aspect-[2/3] rounded-lg" />
      <div className="skeleton mt-2 h-4 w-3/4" />
      <div className="skeleton mt-1 h-3 w-1/2" />
    </div>
  );
}
