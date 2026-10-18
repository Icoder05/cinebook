import { useQuery } from '@tanstack/react-query';
import { useCallback, useSyncExternalStore } from 'react';
import type { City } from '@cinebook/shared';
import { api } from './api';

const KEY = 'cb_city';
const listeners = new Set<() => void>();

function read(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function useCities() {
  return useQuery({
    queryKey: ['cities'],
    queryFn: () => api<{ cities: City[] }>('/cities').then((r) => r.cities),
    staleTime: Infinity,
  });
}

/** Selected city lives in localStorage; defaults to the first seeded city. */
export function useCity() {
  const stored = useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    read,
  );
  const { data: cities } = useCities();
  const city = cities?.find((c) => c.id === stored) ?? cities?.[0] ?? null;

  const setCity = useCallback((id: string) => {
    try {
      localStorage.setItem(KEY, id);
    } catch {
      /* private mode */
    }
    listeners.forEach((l) => l());
  }, []);

  return { city, cities: cities ?? [], setCity, hasChosen: !!stored };
}
