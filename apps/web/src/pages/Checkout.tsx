import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Info } from 'lucide-react';
import { useEffect } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { CANCEL_CUTOFF_HOURS } from '@cinebook/shared';
import { CountdownBadge, useCountdown } from '../components/Countdown';
import { Poster } from '../components/Poster';
import { ErrorState, PageSpinner, Spinner } from '../components/States';
import { api } from '../lib/api';
import { fmtDateLong, fmtTime, formatINR } from '../lib/format';
import { useBooking } from '../lib/queries';

export default function Checkout() {
  const { bookingId } = useParams();
  const { data: b, isLoading, error } = useBooking(bookingId);
  const navigate = useNavigate();
  const qc = useQueryClient();

  const backToSeats = (message: string) =>
    b && navigate(`/showtimes/${b.showtime.id}/seats`, { replace: true, state: { message } });

  const ms = useCountdown(b?.status === 'PENDING' ? b.holdExpiresAt : null, b?.serverTime, () =>
    backToSeats('Your seat hold expired, so the seats were released. Please pick again.'),
  );

  const release = useMutation({
    mutationFn: () => api(`/holds/${bookingId}`, { method: 'DELETE' }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['seats'] });
      backToSeats('Your previous seats were released.');
    },
  });

  useEffect(() => {
    if (b && b.status !== 'PENDING' && b.status !== 'CONFIRMED') {
      backToSeats(
        b.status === 'FAILED' ? 'Payment failed and the seats were released.' : 'That hold is no longer active. Please pick seats again.',
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [b?.status]);

  if (isLoading) return <PageSpinner />;
  if (error || !b) return <ErrorState error={error} />;
  if (b.status === 'CONFIRMED') return <Navigate to={`/bookings/${b.id}`} replace />;
  if (b.status !== 'PENDING') return <PageSpinner />;

  return (
    <div className="container-page max-w-4xl py-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <button className="btn-ghost -ml-3" onClick={() => release.mutate()} disabled={release.isPending}>
          <ArrowLeft className="h-4 w-4" aria-hidden /> Change seats
        </button>
        <CountdownBadge ms={ms} />
      </div>

      <div className="grid gap-6 md:grid-cols-[1fr_340px]">
        <section className="card p-5">
          <h1 className="mb-4 text-lg font-semibold">Booking summary</h1>
          <div className="flex gap-4">
            <Poster path={b.movie.posterPath} title={b.movie.title} size="w185" className="w-20 shrink-0" />
            <div className="text-sm">
              <p className="text-base font-semibold">{b.movie.title}</p>
              <p className="text-ink-muted">
                {b.showtime.language} · {b.showtime.format}
              </p>
              <p className="mt-2 font-medium">{b.theatre.name}</p>
              <p className="text-ink-muted">
                {fmtDateLong(b.showtime.startsAt)} · {fmtTime(b.showtime.startsAt)} · {b.screen.name}
              </p>
            </div>
          </div>

          <table className="mt-6 w-full text-sm">
            <caption className="sr-only">Seats and prices</caption>
            <thead>
              <tr className="border-b text-left text-xs uppercase text-ink-muted">
                <th className="py-2 font-medium">Seat</th>
                <th className="py-2 font-medium">Tier</th>
                <th className="py-2 text-right font-medium">Price</th>
              </tr>
            </thead>
            <tbody>
              {b.seats.map((s) => (
                <tr key={s.seatId} className="border-b border-dashed last:border-0">
                  <td className="py-2 font-medium">{s.label}</td>
                  <td className="py-2">{s.tierName}</td>
                  <td className="py-2 text-right">{formatINR(s.pricePaise)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <aside className="card h-fit p-5">
          <h2 className="mb-3 font-semibold">Payment details</h2>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt>Tickets ({b.seatCount})</dt>
              <dd>{formatINR(b.subtotalPaise)}</dd>
            </div>
            <div className="flex justify-between text-ink-muted">
              <dt>Convenience fee (₹30 × {b.seatCount})</dt>
              <dd>{formatINR(b.feePaise)}</dd>
            </div>
            <div className="flex justify-between text-ink-muted">
              <dt>GST @ 18% on fee</dt>
              <dd>{formatINR(b.taxPaise)}</dd>
            </div>
            <div className="flex justify-between border-t pt-3 text-base font-semibold">
              <dt>Amount payable</dt>
              <dd>{formatINR(b.totalPaise)}</dd>
            </div>
          </dl>
          <Link to={`/pay/${b.id}`} className="btn-primary mt-5 w-full py-3 text-base">
            {release.isPending ? <Spinner /> : `Proceed to pay ${formatINR(b.totalPaise)}`}
          </Link>
          <p className="mt-4 flex gap-2 text-xs text-ink-muted">
            <Info className="h-4 w-4 shrink-0" aria-hidden />
            Cancellable up to {CANCEL_CUTOFF_HOURS} hours before the show. This is a demo: no real money moves.
          </p>
        </aside>
      </div>
    </div>
  );
}
