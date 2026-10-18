import clsx from 'clsx';
import { X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { MAX_SEATS_PER_BOOKING } from '@cinebook/shared';
import { formatINR } from '../lib/format';

// --- Vehicle illustrations ----------------------------------------------------
// Line art on a 160×100 canvas; stroke/fill follow currentColor so they theme easily.

const wheel = (cx: number, cy: number, r: number) => (
  <g key={`${cx}-${cy}`}>
    <circle cx={cx} cy={cy} r={r} className="fill-white" />
    <circle cx={cx} cy={cy} r={r * 0.35} className="fill-brand" />
  </g>
);

function Bicycle() {
  return (
    <>
      {wheel(38, 70, 22)}
      {wheel(122, 70, 22)}
      <path d="M38 70 L78 70 L66 38 Z M66 38 L108 38 L78 70 M108 38 L122 70" className="fill-none" />
      <path d="M56 32 H76 M104 26 L108 38 M98 26 H114" className="fill-none" />
    </>
  );
}

function Scooter() {
  return (
    <>
      <path
        d="M20 70 C18 52 30 44 52 44 H70 L78 60 H104 L116 30 M108 24 H128 M116 30 L130 66"
        className="fill-none"
      />
      <path d="M20 70 C18 52 30 44 52 44 H70 L78 60 H104 L110 70 Z" className="fill-brand-light" />
      <path d="M34 40 Q34 34 42 34 H64 Q70 34 70 40 Z" className="fill-brand/30" />
      {wheel(40, 72, 15)}
      {wheel(128, 72, 15)}
    </>
  );
}

function AutoRickshaw() {
  return (
    <>
      <path
        d="M22 72 V34 Q22 18 40 18 H102 Q118 18 124 34 L136 56 Q140 64 136 72 Z"
        className="fill-brand-light"
      />
      <path d="M22 18 Q22 12 30 12 H100 Q110 12 112 18" className="fill-brand/40" />
      <path d="M48 26 H86 V58 H48 Z" className="fill-white" />
      <path d="M94 26 H110 L120 46 H94 Z" className="fill-white" />
      <path d="M22 60 H48" className="fill-none" />
      {wheel(42, 76, 13)}
      {wheel(126, 76, 11)}
    </>
  );
}

function Hatchback() {
  return (
    <>
      <path
        d="M14 70 V56 Q14 46 28 44 L50 24 Q54 20 62 20 H104 Q112 20 118 28 L132 44 Q146 46 146 58 V70 Z"
        className="fill-brand-light"
      />
      <path d="M56 28 H80 V44 H40 Z M86 28 H104 Q108 28 112 32 L122 44 H86 Z" className="fill-white" />
      {wheel(44, 72, 14)}
      {wheel(118, 72, 14)}
    </>
  );
}

function Suv() {
  return (
    <>
      <path
        d="M10 70 V44 Q10 38 18 36 L32 16 H124 Q130 16 134 22 L144 38 Q150 40 150 48 V70 Z"
        className="fill-brand-light"
      />
      <path d="M38 22 H64 V38 H26 Z M70 22 H96 V38 H70 Z M102 22 H122 L132 38 H102 Z" className="fill-white" />
      <path d="M10 54 H150" className="fill-none" />
      {wheel(42, 72, 15)}
      {wheel(120, 72, 15)}
    </>
  );
}

function Van() {
  return (
    <>
      <path d="M6 70 V24 Q6 14 16 14 H116 Q124 14 130 22 L150 50 V70 Z" className="fill-brand-light" />
      <path
        d="M14 22 H36 V40 H14 Z M42 22 H64 V40 H42 Z M70 22 H92 V40 H70 Z M98 22 H116 Q120 22 124 28 L134 40 H98 Z"
        className="fill-white"
      />
      <path d="M96 22 V66" className="fill-none" />
      {wheel(36, 72, 14)}
      {wheel(122, 72, 14)}
    </>
  );
}

function Bus() {
  return (
    <>
      <path d="M4 74 V20 Q4 10 14 10 H146 Q156 10 156 20 V74 Z" className="fill-brand-light" />
      <path d="M4 18 H156" className="fill-none" />
      {[12, 36, 60, 84, 108].map((x) => (
        <rect key={x} x={x} y={24} width={18} height={18} rx={2} className="fill-white" />
      ))}
      <path d="M132 24 H148 V66 H132 Z" className="fill-white" />
      <path d="M4 54 H128" className="fill-none" />
      {wheel(34, 76, 12)}
      {wheel(112, 76, 12)}
    </>
  );
}

const VEHICLES: { max: number; label: string; Art: () => JSX.Element }[] = [
  { max: 1, label: 'Bicycle', Art: Bicycle },
  { max: 2, label: 'Scooter', Art: Scooter },
  { max: 3, label: 'Auto rickshaw', Art: AutoRickshaw },
  { max: 4, label: 'Car', Art: Hatchback },
  { max: 6, label: 'SUV', Art: Suv },
  { max: 8, label: 'Van', Art: Van },
  { max: 10, label: 'Bus', Art: Bus },
];

export function vehicleFor(n: number) {
  return VEHICLES.find((v) => n <= v.max) ?? VEHICLES[VEHICLES.length - 1];
}

export function VehicleArt({ count, className }: { count: number; className?: string }) {
  const { Art, label } = vehicleFor(count);
  return (
    <svg
      viewBox="0 0 160 100"
      className={clsx('stroke-brand text-brand', className)}
      strokeWidth={3.5}
      strokeLinejoin="round"
      strokeLinecap="round"
      role="img"
      aria-label={`${label} for ${count} ${count === 1 ? 'person' : 'people'}`}
    >
      <Art />
    </svg>
  );
}

// --- Dialog -------------------------------------------------------------------

export interface TierAvailability {
  id: string;
  name: string;
  pricePaise: number;
  available: number;
  total: number;
}

export function SeatCountPicker({
  open,
  initial,
  tiers,
  dismissible,
  onConfirm,
  onClose,
}: {
  open: boolean;
  initial: number;
  tiers: TierAvailability[];
  /** First visit must pick a number; later the dialog can just be closed. */
  dismissible: boolean;
  onConfirm: (n: number) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [count, setCount] = useState(initial);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      setCount(initial);
      d.showModal();
    }
    if (!open && d.open) d.close();
  }, [open, initial]);

  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        if (dismissible) onClose();
      }}
      className="w-[min(480px,calc(100vw-24px))] rounded-2xl p-0 backdrop:bg-black/60"
      aria-labelledby="seat-count-title"
    >
      <div className="relative px-5 pb-5 pt-6 text-center">
        {dismissible && (
          <button onClick={onClose} className="btn-ghost absolute right-2 top-2 p-2" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        )}
        <h2 id="seat-count-title" className="text-lg font-semibold">
          How many seats?
        </h2>

        <div className="mx-auto mt-3 flex h-32 items-center justify-center" aria-live="polite">
          <VehicleArt key={vehicleFor(count).label} count={count} className="h-28 w-44 animate-[pop_.25s_ease-out]" />
        </div>

        <div role="radiogroup" aria-label="Number of seats" className="mx-auto mt-2 grid max-w-[240px] grid-cols-5 justify-items-center gap-1.5 sm:flex sm:max-w-none sm:justify-center">
          {Array.from({ length: MAX_SEATS_PER_BOOKING }, (_, i) => i + 1).map((n) => (
            <button
              key={n}
              role="radio"
              aria-checked={n === count}
              onClick={() => setCount(n)}
              onMouseEnter={() => setCount(n)}
              className={clsx(
                'h-9 w-9 rounded-full text-sm font-medium transition',
                n === count ? 'bg-brand text-white shadow' : 'text-ink hover:bg-brand-light',
              )}
            >
              {n}
            </button>
          ))}
        </div>

        {tiers.length > 0 && (
          <ul className="mt-5 grid grid-cols-2 gap-2 border-t pt-4 text-left sm:grid-cols-3">
            {tiers.map((t) => {
              const ratio = t.total ? t.available / t.total : 0;
              const status =
                t.available === 0
                  ? ['Sold out', 'text-gray-400']
                  : t.available < count
                    ? [`Only ${t.available} left`, 'text-amber-600']
                    : ratio < 0.25
                      ? ['Filling fast', 'text-amber-600']
                      : ['Available', 'text-emerald-600'];
              return (
                <li key={t.id} className="text-xs">
                  <p className="font-medium uppercase tracking-wide text-ink-muted">{t.name}</p>
                  <p className="text-sm font-semibold">{formatINR(t.pricePaise)}</p>
                  <p className={status[1]}>{status[0]}</p>
                </li>
              );
            })}
          </ul>
        )}

        <button className="btn-primary mt-5 w-full py-3 text-base" onClick={() => onConfirm(count)}>
          Select {count} {count === 1 ? 'seat' : 'seats'}
        </button>
      </div>
    </dialog>
  );
}
