import clsx from 'clsx';
import { Link, useSearchParams } from 'react-router-dom';
import { Poster } from '../components/Poster';
import { EmptyState, ErrorState } from '../components/States';
import { fmtDateTime, formatINR } from '../lib/format';
import { useMyBookings } from '../lib/queries';

export default function Bookings() {
  const [params, setParams] = useSearchParams();
  const scope = params.get('tab') === 'past' ? 'past' : 'upcoming';
  const { data, isLoading, error } = useMyBookings(scope);

  return (
    <div className="container-page max-w-3xl py-6">
      <h1 className="mb-4 text-2xl font-bold">My bookings</h1>
      <div role="tablist" className="mb-5 flex gap-2">
        {(['upcoming', 'past'] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={scope === t}
            onClick={() => setParams({ tab: t }, { replace: true })}
            className={clsx('chip capitalize', scope === t && 'chip-active')}
          >
            {t}
          </button>
        ))}
      </div>

      {error ? (
        <ErrorState error={error} />
      ) : isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton h-28 rounded-xl" />
          ))}
        </div>
      ) : !data?.length ? (
        <EmptyState title={scope === 'upcoming' ? 'No upcoming bookings' : 'No past bookings'}>
          <Link to="/" className="btn-primary mt-3">
            Browse movies
          </Link>
        </EmptyState>
      ) : (
        <ul className="space-y-3">
          {data.map((b) => (
            <li key={b.id}>
              <Link to={`/bookings/${b.id}`} className="card flex gap-4 p-4 transition hover:shadow-md">
                <Poster path={b.movie.posterPath} title={b.movie.title} size="w185" className="w-16 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="truncate font-semibold">{b.movie.title}</h2>
                    {b.status === 'CANCELLED' && (
                      <span className="shrink-0 rounded-full bg-gray-200 px-2 py-0.5 text-xs font-medium">Cancelled</span>
                    )}
                  </div>
                  <p className="text-sm text-ink-muted">
                    {fmtDateTime(b.showtime.startsAt)} · {b.showtime.format}
                  </p>
                  <p className="truncate text-sm text-ink-muted">
                    {b.theatre.name}, {b.theatre.city}
                  </p>
                  <p className="mt-1 text-sm">
                    <span className="font-medium">{b.seatLabels.join(', ')}</span> ·{' '}
                    <span className="font-mono text-xs">{b.code}</span> · {formatINR(b.totalPaise)}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
