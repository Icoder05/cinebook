import { useMutation, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { ArrowLeft, Check, Pencil, X } from 'lucide-react';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { MAX_SEATS_PER_BOOKING, type HoldResponse, type SeatMapResponse, type SeatMapSeat } from '@cinebook/shared';
import { SeatCountPicker, type TierAvailability } from '../components/SeatCountPicker';
import { ErrorState, PageSpinner, Spinner } from '../components/States';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDate, fmtTime, formatINR } from '../lib/format';
import { useSeatMap } from '../lib/queries';

const pendingKey = (showtimeId: string) => `cb_pending_seats:${showtimeId}`;
const selectable = (s: SeatMapSeat) => s.state === 'AVAILABLE' || s.state === 'HELD_BY_ME';

function Seat({
  seat,
  selected,
  tierName,
  price,
  onToggle,
}: {
  seat: SeatMapSeat;
  selected: boolean;
  tierName: string;
  price: number;
  onToggle: () => void;
}) {
  if (seat.state === 'BLOCKED') return <span className="h-8 w-8" aria-hidden />;
  const taken = !selectable(seat);
  const stateText = selected ? 'selected' : taken ? (seat.state === 'BOOKED' ? 'sold' : 'on hold') : 'available';
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={taken}
      aria-pressed={selected}
      aria-label={`Row ${seat.row} seat ${seat.col}, ${tierName} ${formatINR(price)}, ${stateText}`}
      title={`${seat.row}${seat.col} · ${tierName} · ${formatINR(price)}`}
      className={clsx(
        'flex h-8 w-8 shrink-0 items-center justify-center rounded-t-md rounded-b-sm border text-[11px] font-medium transition',
        selected && 'border-emerald-600 bg-emerald-600 text-white',
        !selected && !taken && 'border-emerald-500 bg-white text-emerald-700 hover:bg-emerald-500 hover:text-white',
        seat.state === 'BOOKED' && 'cursor-not-allowed border-gray-200 bg-gray-200 text-gray-400',
        seat.state === 'HELD' && 'seat-held cursor-not-allowed border-gray-300 text-gray-500',
      )}
    >
      {selected ? <Check className="h-4 w-4" aria-hidden /> : seat.state === 'BOOKED' ? <X className="h-3.5 w-3.5" aria-hidden /> : seat.col}
    </button>
  );
}

function Legend() {
  const item = 'flex items-center gap-2';
  return (
    <div className="flex flex-wrap justify-center gap-x-5 gap-y-2 text-xs text-ink-muted">
      <span className={item}>
        <span className="h-4 w-4 rounded-sm border border-emerald-500 bg-white" /> Available
      </span>
      <span className={item}>
        <span className="flex h-4 w-4 items-center justify-center rounded-sm bg-emerald-600 text-white">
          <Check className="h-3 w-3" />
        </span>{' '}
        Selected
      </span>
      <span className={item}>
        <span className="seat-held h-4 w-4 rounded-sm border border-gray-300" /> On hold
      </span>
      <span className={item}>
        <span className="flex h-4 w-4 items-center justify-center rounded-sm bg-gray-200 text-gray-400">
          <X className="h-3 w-3" />
        </span>{' '}
        Sold
      </span>
    </div>
  );
}

function useRows(data: SeatMapResponse | undefined) {
  return useMemo(() => {
    if (!data) return [];
    return data.tiers.map((tier) => {
      const rows = new Map<string, SeatMapSeat[]>();
      for (const s of data.seats) {
        if (s.tierId !== tier.id) continue;
        if (!rows.has(s.row)) rows.set(s.row, []);
        rows.get(s.row)!.push(s);
      }
      return { tier, rows: [...rows.entries()] };
    });
  }, [data]);
}

export default function SeatMap() {
  const { id } = useParams();
  const showtimeId = id!;
  const { data, isLoading, error } = useSeatMap(showtimeId);
  const { status } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string[]>([]);
  // "How many seats?" — null until the viewer picks (the dialog opens on load).
  const [seatCount, setSeatCount] = useState<number | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const restored = useRef(false);
  const flash = (location.state as { message?: string } | null)?.message;

  // Restore a selection made before sign-in, or the seats the user already holds.
  useEffect(() => {
    if (!data || restored.current) return;
    restored.current = true;
    let ids: string[] = [];
    try {
      ids = JSON.parse(sessionStorage.getItem(pendingKey(showtimeId)) ?? '[]');
      sessionStorage.removeItem(pendingKey(showtimeId));
    } catch {
      /* ignore */
    }
    if (!ids.length) ids = data.seats.filter((s) => s.state === 'HELD_BY_ME').map((s) => s.id);
    const ok = new Set(data.seats.filter(selectable).map((s) => s.id));
    const restoredIds = ids.filter((x) => ok.has(x)).slice(0, MAX_SEATS_PER_BOOKING);
    setSelected(restoredIds);
    if (restoredIds.length) setSeatCount(restoredIds.length);
    else if (data.showtime.bookable) setPickerOpen(true);
  }, [data, showtimeId]);

  // Polling may reveal that a selected seat was taken by someone else.
  useEffect(() => {
    if (!data) return;
    const byId = new Map(data.seats.map((s) => [s.id, s]));
    const lost = selected.filter((sid) => {
      const s = byId.get(sid);
      return !s || !selectable(s);
    });
    if (lost.length) {
      setSelected((cur) => cur.filter((x) => !lost.includes(x)));
      const labels = lost.map((sid) => byId.get(sid)).filter(Boolean).map((s) => `${s!.row}${s!.col}`);
      toast.warning(`${labels.join(', ') || 'A seat'} was just taken by someone else`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const tierById = useMemo(() => new Map(data?.tiers.map((t) => [t.id, t]) ?? []), [data]);
  const seatById = useMemo(() => new Map(data?.seats.map((s) => [s.id, s]) ?? []), [data]);
  const groups = useRows(data);
  const tierAvailability = useMemo<TierAvailability[]>(
    () =>
      data?.tiers.map((t) => {
        const inTier = data.seats.filter((s) => s.tierId === t.id && s.state !== 'BLOCKED');
        return { ...t, total: inTier.length, available: inTier.filter(selectable).length };
      }) ?? [],
    [data],
  );

  const hold = useMutation({
    mutationFn: (seatIds: string[]) =>
      api<HoldResponse>(`/showtimes/${showtimeId}/holds`, { method: 'POST', body: { seatIds } }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['seats', showtimeId] });
      navigate(`/checkout/${r.bookingId}`);
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'SEATS_UNAVAILABLE') {
        const lost = (err.details as { seatIds?: string[] })?.seatIds ?? [];
        setSelected((cur) => cur.filter((x) => !lost.includes(x)));
        toast.error('Sorry — some of those seats were just taken. Please pick again.');
        qc.invalidateQueries({ queryKey: ['seats', showtimeId] });
      } else {
        toast.error(err instanceof Error ? err.message : 'Could not hold seats');
      }
    },
  });

  if (isLoading) return <PageSpinner />;
  if (error || !data) return <ErrorState error={error} />;

  const { layout } = data.screen;
  const aisles = new Set(layout.aisles);
  const want = seatCount ?? 1;

  /**
   * Like BookMyShow: tapping a seat grabs a block of adjacent free seats in that row
   * (rightwards first, then leftwards), never jumping an aisle, gap or taken seat.
   */
  const blockFrom = (start: SeatMapSeat, need: number, taken: Set<string>): string[] => {
    const row = data.seats.filter((s) => s.row === start.row).sort((a, b) => a.col - b.col);
    const i = row.findIndex((s) => s.id === start.id);
    const ok = (s: SeatMapSeat | undefined) => !!s && selectable(s) && !taken.has(s.id);
    const adjacent = (a: SeatMapSeat, b: SeatMapSeat) => {
      const [l, r] = a.col < b.col ? [a, b] : [b, a];
      return r.col - l.col === 1 && !aisles.has(l.col);
    };
    const block = [start];
    for (let j = i + 1; block.length < need && ok(row[j]) && adjacent(row[j - 1], row[j]); j++) block.push(row[j]);
    for (let j = i - 1; block.length < need && ok(row[j]) && adjacent(row[j], row[j + 1]); j--) block.unshift(row[j]);
    return block.map((s) => s.id);
  };

  const toggle = (sid: string) => {
    if (seatCount === null) return setPickerOpen(true);
    const seat = seatById.get(sid);
    if (!seat) return;
    setSelected((cur) => {
      if (cur.includes(sid)) return cur.filter((x) => x !== sid);
      // A full selection starts over from the tapped seat.
      const base = cur.length >= want ? [] : cur;
      return [...base, ...blockFrom(seat, want - base.length, new Set(base))];
    });
  };

  const changeCount = (n: number) => {
    setPickerOpen(false);
    if (n !== seatCount) setSelected((cur) => (cur.length > n ? [] : cur));
    setSeatCount(n);
  };

  const chosen = selected.map((sid) => seatById.get(sid)).filter(Boolean) as SeatMapSeat[];
  const subtotal = chosen.reduce((n, s) => n + (tierById.get(s.tierId)?.pricePaise ?? 0), 0);
  const remaining = want - chosen.length;

  const proceed = () => {
    if (status !== 'authed') {
      try {
        sessionStorage.setItem(pendingKey(showtimeId), JSON.stringify(selected));
      } catch {
        /* ignore */
      }
      navigate('/login', { state: { from: location, reason: 'Sign in to book your seats' } });
      return;
    }
    hold.mutate(selected);
  };

  return (
    <div className="pb-28">
      <div className="border-b bg-white">
        <div className="container-page flex items-center gap-3 py-3">
          <button onClick={() => navigate(-1)} className="btn-ghost p-2" aria-label="Back">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="min-w-0">
            <h1 className="truncate font-semibold">
              {data.movie.title}{' '}
              {data.movie.certificate && <span className="ml-1 rounded border px-1 text-xs font-normal">{data.movie.certificate}</span>}
            </h1>
            <p className="truncate text-xs text-ink-muted">
              {data.theatre.name} · {fmtDate(data.showtime.startsAt)}, {fmtTime(data.showtime.startsAt)} · {data.showtime.format} ·{' '}
              {data.showtime.language} · {data.screen.name}
            </p>
          </div>
          {data.showtime.bookable && seatCount !== null && (
            <button
              onClick={() => setPickerOpen(true)}
              className="ml-auto flex shrink-0 items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium hover:border-brand hover:text-brand"
              aria-label={`${seatCount} tickets. Change number of seats`}
            >
              {seatCount} {seatCount === 1 ? 'Ticket' : 'Tickets'}
              <Pencil className="h-3.5 w-3.5" aria-hidden />
            </button>
          )}
        </div>
      </div>

      <SeatCountPicker
        open={pickerOpen}
        initial={seatCount ?? 2}
        tiers={tierAvailability}
        dismissible={seatCount !== null}
        onConfirm={changeCount}
        onClose={() => setPickerOpen(false)}
      />

      <div className="container-page mt-4 space-y-3">
        {flash && <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{flash}</div>}
        {data.myHold && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
            <span>You already have seats on hold for this show.</span>
            <Link to={`/checkout/${data.myHold.bookingId}`} className="font-semibold underline">
              Continue to checkout
            </Link>
          </div>
        )}
        {!data.showtime.bookable && (
          <div className="rounded-lg bg-gray-100 px-4 py-3 text-sm">Booking is closed for this show.</div>
        )}
      </div>

      <div className="container-page mt-4">
        <div className="card overflow-x-auto px-4 py-6">
          <div className="mx-auto w-max space-y-6" role="group" aria-label="Seat map">
            {groups.map(({ tier, rows }) => (
              <section key={tier.id} aria-label={`${tier.name} ${formatINR(tier.pricePaise)}`}>
                <h2 className="mb-2 border-b pb-1 text-xs uppercase tracking-wide text-ink-muted">
                  {formatINR(tier.pricePaise)} {tier.name}
                </h2>
                <div className="space-y-1.5">
                  {rows.map(([row, seats]) => {
                    const byCol = new Map(seats.map((s) => [s.col, s]));
                    return (
                      <div key={row} className="flex items-center gap-1.5">
                        <span className="w-6 shrink-0 text-center text-xs text-ink-muted" aria-hidden>
                          {row}
                        </span>
                        {Array.from({ length: layout.cols }, (_, i) => i + 1).map((col) => {
                          const s = byCol.get(col);
                          return (
                            <Fragment key={col}>
                              {s ? (
                                <Seat
                                  seat={s}
                                  selected={selected.includes(s.id)}
                                  tierName={tier.name}
                                  price={tier.pricePaise}
                                  onToggle={() => toggle(s.id)}
                                />
                              ) : (
                                <span className="h-8 w-8 shrink-0" aria-hidden />
                              )}
                              {aisles.has(col) && <span className="w-4 shrink-0" aria-hidden />}
                            </Fragment>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
            <div className="pt-4">
              <div className="mx-auto h-2 w-3/4 rounded-[50%] bg-gradient-to-b from-sky-300 to-transparent" />
              <p className="mt-2 text-center text-xs text-ink-muted">All eyes this way please!</p>
            </div>
          </div>
        </div>
        <div className="mt-4">
          <Legend />
        </div>
      </div>

      {data.showtime.bookable && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-white shadow-[0_-4px_12px_rgba(0,0,0,0.06)]">
          <div className="container-page flex items-center justify-between gap-4 py-3">
            <div className="min-w-0 text-sm">
              {chosen.length ? (
                <>
                  <p className="font-semibold">
                    {chosen.length} of {want} seat{want > 1 ? 's' : ''} · {formatINR(subtotal)}
                  </p>
                  <p className="truncate text-xs text-ink-muted">
                    {chosen.map((s) => `${s.row}${s.col}`).join(', ')}
                    {remaining > 0 && <span className="text-amber-700"> · pick {remaining} more</span>}
                  </p>
                </>
              ) : (
                <p className="text-ink-muted">
                  {seatCount ? `Tap a seat to pick ${seatCount} together` : 'Choose how many seats'}
                </p>
              )}
            </div>
            <button
              className="btn-primary min-w-[140px] py-3"
              disabled={!chosen.length || remaining !== 0 || hold.isPending}
              onClick={proceed}
            >
              {hold.isPending ? <Spinner /> : status === 'authed' ? `Pay ${chosen.length ? formatINR(subtotal) : ''}` : 'Proceed'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
