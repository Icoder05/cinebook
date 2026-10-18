import clsx from 'clsx';
import { Timer } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

/**
 * Counts down to `until`, corrected for client clock skew using the server's
 * timestamp from the same response.
 */
export function useCountdown(until: string | null | undefined, serverTime?: string, onExpire?: () => void) {
  const skew = useRef(0);
  useEffect(() => {
    if (serverTime) skew.current = new Date(serverTime).getTime() - Date.now();
  }, [serverTime]);

  const compute = () => (until ? Math.max(0, new Date(until).getTime() - (Date.now() + skew.current)) : 0);
  const [ms, setMs] = useState(compute);
  const fired = useRef(false);
  const cb = useRef(onExpire);
  cb.current = onExpire;

  useEffect(() => {
    fired.current = false;
    const tick = () => {
      const left = compute();
      setMs(left);
      if (left <= 0 && until && !fired.current) {
        fired.current = true;
        cb.current?.();
      }
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [until]);
  return ms;
}

export function CountdownBadge({ ms, className }: { ms: number; className?: string }) {
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  const urgent = total <= 60;
  return (
    <div
      className={clsx(
        'inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium',
        urgent ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-800',
        className,
      )}
      role="timer"
      aria-live={urgent ? 'assertive' : 'off'}
    >
      <Timer className="h-4 w-4" aria-hidden />
      <span>
        Seats held for{' '}
        <span className="tabular-nums">
          {String(m).padStart(2, '0')}:{String(s).padStart(2, '0')}
        </span>
      </span>
    </div>
  );
}
