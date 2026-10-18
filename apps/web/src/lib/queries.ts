import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type {
  BookingDetail,
  BookingListItem,
  MovieDetail,
  MovieShowtimesResponse,
  MovieSummary,
  SeatMapResponse,
} from '@cinebook/shared';
import { api } from './api';

export interface MovieFilters {
  status?: 'now_showing' | 'upcoming';
  city?: string;
  lang?: string;
  genre?: string;
  format?: string;
  q?: string;
}

function qs(params: Record<string, string | undefined>) {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) s.set(k, v);
  const str = s.toString();
  return str ? `?${str}` : '';
}

export function useMovies(f: MovieFilters, enabled = true) {
  return useQuery({
    queryKey: ['movies', f],
    queryFn: () => api<{ movies: MovieSummary[] }>(`/movies${qs({ ...f })}`).then((r) => r.movies),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useMovie(id: string | undefined) {
  return useQuery({
    queryKey: ['movie', id],
    queryFn: () => api<{ movie: MovieDetail }>(`/movies/${id}`).then((r) => r.movie),
    enabled: !!id,
  });
}

export function useShowtimes(movieId: string | undefined, city: string | undefined, date: string | undefined) {
  return useQuery({
    queryKey: ['showtimes', movieId, city, date],
    queryFn: () => api<MovieShowtimesResponse>(`/movies/${movieId}/showtimes${qs({ city, date })}`),
    enabled: !!movieId && !!city,
    staleTime: 15_000,
    placeholderData: keepPreviousData,
  });
}

/** SEAT-4: the seat map refreshes every 5 s while open. Never cached. */
export function useSeatMap(showtimeId: string | undefined) {
  return useQuery({
    queryKey: ['seats', showtimeId],
    queryFn: () => api<SeatMapResponse>(`/showtimes/${showtimeId}/seats`),
    enabled: !!showtimeId,
    staleTime: 0,
    refetchInterval: 5_000,
    refetchIntervalInBackground: false,
  });
}

export function useBooking(id: string | undefined) {
  return useQuery({
    queryKey: ['bookings', 'detail', id],
    queryFn: () => api<{ booking: BookingDetail }>(`/bookings/${id}`).then((r) => r.booking),
    enabled: !!id,
    staleTime: 0,
  });
}

export function useMyBookings(scope: 'upcoming' | 'past') {
  return useQuery({
    queryKey: ['bookings', 'list', scope],
    queryFn: () => api<{ bookings: BookingListItem[] }>(`/bookings?scope=${scope}`).then((r) => r.bookings),
    staleTime: 0,
  });
}
