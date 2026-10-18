import clsx from 'clsx';
import { Film } from 'lucide-react';
import { posterUrl } from '../lib/format';

const GRADIENTS = [
  'from-rose-500 to-orange-400',
  'from-indigo-600 to-sky-400',
  'from-emerald-600 to-lime-400',
  'from-fuchsia-600 to-pink-400',
  'from-amber-600 to-yellow-300',
  'from-slate-700 to-slate-400',
  'from-cyan-700 to-teal-300',
];

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** TMDB poster, or a generated title card when there is no image. */
export function Poster({
  path,
  title,
  size = 'w342',
  className,
  eager = false,
}: {
  path: string | null;
  title: string;
  size?: 'w185' | 'w342' | 'w500';
  className?: string;
  eager?: boolean;
}) {
  const url = posterUrl(path, size);
  const thumb = size === 'w185';
  return (
    <div className={clsx('relative aspect-[2/3] overflow-hidden rounded-lg bg-gray-200', className)}>
      {url ? (
        <img
          src={url}
          alt={`${title} poster`}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          className="h-full w-full object-cover"
        />
      ) : (
        <div
          className={clsx(
            'flex h-full w-full flex-col justify-end bg-gradient-to-br text-white',
            // Full-size cards leave room for the rating strip MovieCard overlays at the bottom.
            thumb ? 'p-1.5' : 'p-3 pb-10',
            GRADIENTS[hash(title) % GRADIENTS.length],
          )}
          role="img"
          aria-label={`${title} poster`}
        >
          {!thumb && <Film className="mb-auto h-6 w-6 opacity-70" aria-hidden />}
          <span className={clsx('font-bold leading-tight drop-shadow', thumb ? 'line-clamp-4 text-[10px]' : 'text-lg')}>
            {title}
          </span>
        </div>
      )}
    </div>
  );
}
