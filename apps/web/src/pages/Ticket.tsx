import { useMutation, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { ArrowLeft, CheckCircle2, MapPin } from 'lucide-react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { CANCEL_CUTOFF_HOURS, type BookingDetail } from '@cinebook/shared';
import { Poster } from '../components/Poster';
import { ErrorState, PageSpinner, Spinner } from '../components/States';
import { api } from '../lib/api';
import { fmtDateLong, fmtTime, formatINR } from '../lib/format';
import { useBooking } from '../lib/queries';

const STATUS_STYLE: Record<BookingDetail['status'], string> = {
  CONFIRMED: 'bg-emerald-100 text-emerald-800',
  CANCELLED: 'bg-gray-200 text-gray-700',
  PENDING: 'bg-amber-100 text-amber-800',
  FAILED: 'bg-red-100 text-red-800',
  EXPIRED: 'bg-gray-200 text-gray-700',
};

export default function Ticket() {
  const { id } = useParams();
  const { data: b, isLoading, error } = useBooking(id);
  const justBooked = (useLocation().state as { justBooked?: boolean } | null)?.justBooked;
  const qc = useQueryClient();

  const cancel = useMutation({
    mutationFn: () => api<{ booking: BookingDetail }>(`/bookings/${id}/cancel`, { method: 'POST' }),
    onSuccess: (r) => {
      qc.setQueryData(['bookings', 'detail', id], r.booking);
      qc.invalidateQueries({ queryKey: ['bookings', 'list'] });
      qc.invalidateQueries({ queryKey: ['seats'] });
      toast.success(`Booking cancelled. ${formatINR(r.booking.totalPaise)} will be refunded (simulated).`);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Could not cancel'),
  });

  if (isLoading) return <PageSpinner />;
  if (error || !b) return <ErrorState error={error} />;

  return (
    <div className="container-page max-w-2xl py-6">
      <Link to="/bookings" className="btn-ghost -ml-3 mb-3">
        <ArrowLeft className="h-4 w-4" aria-hidden /> My bookings
      </Link>

      {justBooked && b.status === 'CONFIRMED' && (
        <div className="mb-4 flex items-center gap-3 rounded-xl bg-emerald-600 p-4 text-white" role="status">
          <CheckCircle2 className="h-8 w-8 shrink-0" aria-hidden />
          <div>
            <p className="font-semibold">Booking confirmed!</p>
            <p className="text-sm text-white/90">Show this QR code at the cinema entrance.</p>
          </div>
        </div>
      )}

      <article className="card overflow-hidden" aria-label="E-ticket">
        <div className="flex gap-4 p-5">
          <Poster path={b.movie.posterPath} title={b.movie.title} size="w185" className="w-20 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <h1 className="text-lg font-semibold leading-tight">{b.movie.title}</h1>
              <span className={clsx('shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold', STATUS_STYLE[b.status])}>
                {b.status}
              </span>
            </div>
            <p className="text-sm text-ink-muted">
              {[b.movie.certificate, b.showtime.language, b.showtime.format].filter(Boolean).join(' · ')}
            </p>
            <p className="mt-2 text-sm font-medium">
              {fmtDateLong(b.showtime.startsAt)} | {fmtTime(b.showtime.startsAt)}
            </p>
            <p className="mt-1 flex items-start gap-1 text-sm text-ink-muted">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              {b.theatre.name}, {b.theatre.city}
            </p>
          </div>
        </div>

        <div className="relative border-t-2 border-dashed border-gray-200">
          <span className="absolute -left-3 -top-3 h-6 w-6 rounded-full bg-surface" aria-hidden />
          <span className="absolute -right-3 -top-3 h-6 w-6 rounded-full bg-surface" aria-hidden />
        </div>

        <div className="flex flex-col items-center gap-5 p-5 sm:flex-row sm:items-start">
          {b.qrDataUrl ? (
            <img src={b.qrDataUrl} alt={`QR code for booking ${b.code}`} className="h-40 w-40 rounded-lg border" />
          ) : (
            <div className="flex h-40 w-40 items-center justify-center rounded-lg bg-gray-100 text-center text-xs text-ink-muted">
              QR not available
              <br />({b.status.toLowerCase()})
            </div>
          )}
          <dl className="grid w-full grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <div>
              <dt className="text-xs uppercase text-ink-muted">Booking ID</dt>
              <dd className="font-mono text-base font-semibold tracking-wider">{b.code}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase text-ink-muted">Screen</dt>
              <dd className="font-medium">{b.screen.name}</dd>
            </div>
            <div className="col-span-2">
              <dt className="text-xs uppercase text-ink-muted">
                {b.seatCount} ticket{b.seatCount > 1 ? 's' : ''}
              </dt>
              <dd className="font-medium">
                {b.seats.map((s) => `${s.tierName} - ${s.label}`).join(', ')}
              </dd>
            </div>
          </dl>
        </div>

        <div className="bg-surface/60 px-5 py-4 text-sm">
          <div className="flex justify-between">
            <span>Tickets</span>
            <span>{formatINR(b.subtotalPaise)}</span>
          </div>
          <div className="flex justify-between text-ink-muted">
            <span>Convenience fee + GST</span>
            <span>{formatINR(b.feePaise + b.taxPaise)}</span>
          </div>
          <div className="mt-2 flex justify-between border-t pt-2 font-semibold">
            <span>Total paid</span>
            <span>{formatINR(b.totalPaise)}</span>
          </div>
          {b.payment && (
            <p className="mt-2 text-xs text-ink-muted">
              {b.payment.method.toUpperCase()} {b.payment.instrument} · Ref {b.payment.fakeTxnRef ?? '—'} ·{' '}
              {b.payment.status === 'REFUNDED' ? 'Refunded' : b.payment.status.toLowerCase()}
            </p>
          )}
        </div>
      </article>

      {b.status === 'CONFIRMED' && (
        <div className="mt-4 text-center">
          {b.canCancel ? (
            <button
              className="btn-outline"
              disabled={cancel.isPending}
              onClick={() => {
                if (confirm('Cancel this booking? The seats will be released and the amount refunded.')) cancel.mutate();
              }}
            >
              {cancel.isPending ? <Spinner /> : 'Cancel booking'}
            </button>
          ) : (
            <p className="text-sm text-ink-muted">
              Cancellation closes {CANCEL_CUTOFF_HOURS} hours before the show.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
