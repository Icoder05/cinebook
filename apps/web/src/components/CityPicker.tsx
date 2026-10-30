import clsx from 'clsx';
import { Building2, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useCity } from '../lib/city';

export function CityPicker({ open, onClose: close }: { open: boolean; onClose: () => void }) {
  const { city, cities, setCity, hasChosen } = useCity();
  const dialogRef = useRef<HTMLDialogElement>(null);
  // Dismissing without choosing keeps the default city, so we don't ask again.
  const onClose = () => {
    if (!hasChosen && city) setCity(city.id);
    close();
  };

  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      onClick={(e) => e.target === dialogRef.current && onClose()}
      className="w-[min(560px,calc(100vw-32px))] rounded-2xl p-0 backdrop:bg-black/50"
      aria-labelledby="city-title"
    >
      <div className="p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 id="city-title" className="text-lg font-semibold">
            Select your city
          </h2>
          <button className="btn-ghost p-2" onClick={onClose} aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {cities.map((c) => (
            <li key={c.id}>
              <button
                onClick={() => {
                  setCity(c.id);
                  onClose();
                }}
                className={clsx(
                  'flex w-full flex-col items-center gap-2 rounded-xl border p-4 text-sm transition hover:border-brand hover:text-brand',
                  c.id === city?.id ? 'border-brand bg-brand-light text-brand-dark' : 'border-gray-200',
                )}
                aria-pressed={c.id === city?.id}
              >
                <Building2 className="h-8 w-8" aria-hidden />
                <span className="font-medium">{c.name}</span>
                <span className="text-xs text-ink-muted">{c.state}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </dialog>
  );
}
