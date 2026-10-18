import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { AlertTriangle, CreditCard, Landmark, Lock, ShieldCheck, Smartphone, XCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { z } from 'zod';
import {
  BANKS,
  cardFormSchema,
  type PayInput,
  type PayResponse,
  TEST_CARDS,
  upiPaymentSchema,
} from '@cinebook/shared';
import { CountdownBadge, useCountdown } from '../components/Countdown';
import { ErrorState, PageSpinner, Spinner } from '../components/States';
import { api, ApiError } from '../lib/api';
import { formatINR } from '../lib/format';
import { useBooking } from '../lib/queries';

const CLIENT_TIMEOUT_MS = 8_000;

type Phase =
  | { kind: 'idle' }
  | { kind: 'processing' }
  | { kind: 'timeout' }
  | { kind: 'failed'; reason: string };

function newKey() {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
}

function CardForm({ onPay, busy }: { onPay: (p: PayInput) => void; busy: boolean }) {
  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<z.input<typeof cardFormSchema>, unknown, z.output<typeof cardFormSchema>>({
    resolver: zodResolver(cardFormSchema),
    defaultValues: { method: 'card', cardNumber: '', name: '', expiry: '', cvv: '' },
  });
  // The CVV is validated here and deliberately not sent anywhere.
  const submit = handleSubmit(({ cvv: _cvv, ...card }) => onPay(card));

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <div>
        <label className="label" htmlFor="cardNumber">
          Card number
        </label>
        <input
          id="cardNumber"
          inputMode="numeric"
          autoComplete="cc-number"
          placeholder="4242 4242 4242 4242"
          className="input font-mono tracking-wider"
          {...register('cardNumber', {
            onChange: (e) => {
              const digits = e.target.value.replace(/\D/g, '').slice(0, 19);
              setValue('cardNumber', digits.replace(/(.{4})/g, '$1 ').trim());
            },
          })}
          aria-invalid={!!errors.cardNumber}
        />
        {errors.cardNumber && <p className="field-error">{errors.cardNumber.message}</p>}
      </div>
      <div>
        <label className="label" htmlFor="name">
          Name on card
        </label>
        <input id="name" autoComplete="cc-name" className="input" {...register('name')} aria-invalid={!!errors.name} />
        {errors.name && <p className="field-error">{errors.name.message}</p>}
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label" htmlFor="expiry">
            Expiry (MM/YY)
          </label>
          <input
            id="expiry"
            inputMode="numeric"
            autoComplete="cc-exp"
            placeholder="12/29"
            className="input"
            {...register('expiry', {
              onChange: (e) => {
                const d = e.target.value.replace(/\D/g, '').slice(0, 4);
                setValue('expiry', d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d);
              },
            })}
            aria-invalid={!!errors.expiry}
          />
          {errors.expiry && <p className="field-error">{errors.expiry.message}</p>}
        </div>
        <div>
          <label className="label" htmlFor="cvv">
            CVV
          </label>
          <input
            id="cvv"
            type="password"
            inputMode="numeric"
            autoComplete="cc-csc"
            maxLength={4}
            className="input"
            {...register('cvv')}
            aria-invalid={!!errors.cvv}
          />
          {errors.cvv && <p className="field-error">{errors.cvv.message}</p>}
        </div>
      </div>
      <PayButton busy={busy} />
      <details className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
        <summary className="cursor-pointer font-medium">Test cards</summary>
        <ul className="mt-2 space-y-1 font-mono">
          <li>{TEST_CARDS.success} → success</li>
          <li>{TEST_CARDS.fail} → declined (ends 0000)</li>
          <li>{TEST_CARDS.timeout} → bank timeout (ends 1111)</li>
          <li className="font-sans">Any future expiry, any 3-digit CVV.</li>
        </ul>
      </details>
    </form>
  );
}

function UpiForm({ onPay, busy }: { onPay: (p: PayInput) => void; busy: boolean }) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<z.infer<typeof upiPaymentSchema>>({
    resolver: zodResolver(upiPaymentSchema),
    defaultValues: { method: 'upi', upiId: '' },
  });
  return (
    <form onSubmit={handleSubmit(onPay)} noValidate className="space-y-4">
      <div>
        <label className="label" htmlFor="upiId">
          UPI ID
        </label>
        <input id="upiId" placeholder="yourname@okbank" className="input" {...register('upiId')} aria-invalid={!!errors.upiId} />
        {errors.upiId && <p className="field-error">{errors.upiId.message}</p>}
        <p className="mt-1 text-xs text-slate-500">Tip: an id starting with “fail” is declined.</p>
      </div>
      <PayButton busy={busy} />
    </form>
  );
}

function NetbankingForm({ onPay, busy }: { onPay: (p: PayInput) => void; busy: boolean }) {
  const [bank, setBank] = useState<string>();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (bank) onPay({ method: 'netbanking', bank });
      }}
      className="space-y-4"
    >
      <fieldset>
        <legend className="label">Choose your bank</legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {BANKS.map((b) => (
            <label
              key={b.code}
              className={clsx(
                'flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm',
                bank === b.code ? 'border-blue-600 bg-blue-50' : 'border-slate-200 hover:border-slate-400',
              )}
            >
              <input type="radio" name="bank" value={b.code} checked={bank === b.code} onChange={() => setBank(b.code)} />
              {b.name}
            </label>
          ))}
        </div>
      </fieldset>
      <PayButton busy={busy} disabled={!bank} />
    </form>
  );
}

function PayButton({ busy, disabled }: { busy: boolean; disabled?: boolean }) {
  return (
    <button
      type="submit"
      disabled={busy || disabled}
      className="btn w-full bg-blue-600 py-3 text-base text-white hover:bg-blue-700"
    >
      {busy ? (
        <>
          <Spinner /> Processing…
        </>
      ) : (
        <>
          <Lock className="h-4 w-4" aria-hidden /> Pay securely
        </>
      )}
    </button>
  );
}

export default function Pay() {
  const { bookingId } = useParams();
  const { data: b, isLoading, error } = useBooking(bookingId);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [tab, setTab] = useState<'card' | 'upi' | 'netbanking'>('card');
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  // One key per attempt: double-clicks and timeout-retries reuse it, so the
  // server can never charge twice for the same intent.
  const key = useRef(newKey());
  const lastInput = useRef<PayInput | null>(null);
  // Set once this page completes a payment, so any later redirect keeps the success banner.
  const paidHere = useRef(false);

  const backToSeats = (message: string) =>
    b && navigate(`/showtimes/${b.showtime.id}/seats`, { replace: true, state: { message } });

  const ms = useCountdown(b?.status === 'PENDING' ? b.holdExpiresAt : null, b?.serverTime, () => {
    if (phase.kind !== 'processing') backToSeats('Your seat hold expired before payment. The seats were released.');
  });

  useEffect(() => {
    if (b && (b.status === 'EXPIRED' || b.status === 'CANCELLED')) {
      backToSeats('That booking is no longer active. Please pick seats again.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [b?.status]);

  async function submit(input: PayInput) {
    if (phase.kind === 'processing') return;
    lastInput.current = input;
    setPhase({ kind: 'processing' });
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), CLIENT_TIMEOUT_MS);
    try {
      const r = await api<PayResponse>(`/bookings/${bookingId}/pay`, {
        method: 'POST',
        body: input,
        headers: { 'Idempotency-Key': key.current },
        signal: ctrl.signal,
      });
      // Only the lists: refetching this booking here would re-render the page mid-navigation.
      qc.invalidateQueries({ queryKey: ['bookings', 'list'] });
      if (r.status === 'SUCCESS') paidHere.current = true;
      qc.invalidateQueries({ queryKey: ['seats'] });
      if (r.status === 'SUCCESS') {
        navigate(`/bookings/${r.bookingId}`, { replace: true, state: { justBooked: true } });
      } else {
        setPhase({ kind: 'failed', reason: r.failureReason ?? 'Payment was declined' });
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setPhase({ kind: 'timeout' });
      } else if (err instanceof ApiError && err.code === 'HOLD_EXPIRED') {
        qc.invalidateQueries({ queryKey: ['seats'] });
        backToSeats(err.message);
      } else if (err instanceof ApiError && err.code === 'ALREADY_PAID') {
        navigate(`/bookings/${bookingId}`, { replace: true });
      } else if (err instanceof ApiError && err.code === 'PAYMENT_IN_PROGRESS') {
        setPhase({ kind: 'timeout' });
      } else {
        setPhase({ kind: 'idle' });
        toast.error(err instanceof Error ? err.message : 'Payment failed');
      }
    } finally {
      clearTimeout(timer);
    }
  }

  if (isLoading) return <PageSpinner />;
  if (error || !b) return <ErrorState error={error} />;
  if (b.status === 'CONFIRMED') {
    return <Navigate to={`/bookings/${b.id}`} replace state={paidHere.current ? { justBooked: true } : undefined} />;
  }

  const busy = phase.kind === 'processing';
  const tabs = [
    ['card', 'Card', CreditCard],
    ['upi', 'UPI', Smartphone],
    ['netbanking', 'Net banking', Landmark],
  ] as const;

  return (
    <div className="min-h-screen">
      <div className="bg-amber-400 px-4 py-1.5 text-center text-xs font-semibold text-amber-950">
        TEST MODE — no real money. Use the test cards below.
      </div>
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2 font-bold text-blue-700">
            <ShieldCheck className="h-6 w-6" aria-hidden /> FakePay
          </div>
          {b.status === 'PENDING' && <CountdownBadge ms={ms} />}
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-6">
        <div className="mb-4 flex items-center justify-between rounded-xl bg-white p-4 shadow-sm">
          <div className="text-sm">
            <p className="text-slate-500">Paying CineBook for</p>
            <p className="font-medium">
              {b.movie.title} · {b.seats.map((s) => s.label).join(', ')}
            </p>
          </div>
          <p className="text-2xl font-bold">{formatINR(b.totalPaise)}</p>
        </div>

        {phase.kind === 'failed' || b.status === 'FAILED' ? (
          <div className="rounded-xl bg-white p-8 text-center shadow-sm">
            <XCircle className="mx-auto h-14 w-14 text-red-500" aria-hidden />
            <h1 className="mt-3 text-xl font-semibold">Payment failed</h1>
            <p className="mt-1 text-slate-600">
              {phase.kind === 'failed' ? phase.reason : 'This payment was declined.'} Your seats have been released and
              nothing was charged.
            </p>
            <button className="btn-primary mt-6" onClick={() => backToSeats('Payment failed. Please choose your seats again.')}>
              Back to seat selection
            </button>
          </div>
        ) : phase.kind === 'timeout' ? (
          <div className="rounded-xl bg-white p-8 text-center shadow-sm" role="alert">
            <AlertTriangle className="mx-auto h-14 w-14 text-amber-500" aria-hidden />
            <h1 className="mt-3 text-xl font-semibold">The bank is taking too long</h1>
            <p className="mt-1 text-slate-600">
              We didn't hear back in time. Retrying is safe — it uses the same payment reference, so you will never be
              charged twice.
            </p>
            <button className="btn mt-6 bg-blue-600 text-white hover:bg-blue-700" onClick={() => lastInput.current && submit(lastInput.current)}>
              Check status &amp; retry
            </button>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl bg-white shadow-sm md:grid md:grid-cols-[200px_1fr]">
            <div role="tablist" aria-label="Payment method" className="flex border-b md:flex-col md:border-b-0 md:border-r">
              {tabs.map(([k, label, Icon]) => (
                <button
                  key={k}
                  role="tab"
                  aria-selected={tab === k}
                  disabled={busy}
                  onClick={() => setTab(k)}
                  className={clsx(
                    'flex flex-1 items-center justify-center gap-2 px-4 py-3 text-sm font-medium md:flex-none md:justify-start',
                    tab === k ? 'bg-blue-50 text-blue-700 md:border-l-4 md:border-blue-600' : 'text-slate-600 hover:bg-slate-50',
                  )}
                >
                  <Icon className="h-4 w-4" aria-hidden /> {label}
                </button>
              ))}
            </div>
            <div role="tabpanel" className="p-5">
              {tab === 'card' && <CardForm onPay={submit} busy={busy} />}
              {tab === 'upi' && <UpiForm onPay={submit} busy={busy} />}
              {tab === 'netbanking' && <NetbankingForm onPay={submit} busy={busy} />}
            </div>
          </div>
        )}

        <p className="mt-6 flex items-center justify-center gap-1 text-xs text-slate-500">
          <Lock className="h-3 w-3" aria-hidden /> Only the last 4 digits of a card are ever stored.
        </p>
      </main>
    </div>
  );
}
