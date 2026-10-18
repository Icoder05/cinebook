import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { CalendarPlus, RefreshCw, Trash2 } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { toast } from 'sonner';
import { BOOKING_STATUSES, FORMATS, type MovieSummary } from '@cinebook/shared';
import { AdminNav } from '../../components/Layout';
import { EmptyState, Spinner } from '../../components/States';
import { api } from '../../lib/api';
import { useCities } from '../../lib/city';
import { fmtDateTime, fmtTime, formatINR } from '../../lib/format';

// --- small helpers ------------------------------------------------------------

function useAdmin<T>(key: unknown[], path: string) {
  return useQuery({ queryKey: ['admin', ...key], queryFn: () => api<T>(path), staleTime: 0 });
}

function useAdminMutation<V>(fn: (v: V) => Promise<unknown>, success: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin'] });
      qc.invalidateQueries({ queryKey: ['movies'] });
      toast.success(success);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Request failed'),
  });
}

function Page({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="container-page py-6">
      <AdminNav />
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{title}</h1>
        {actions}
      </div>
      {children}
    </div>
  );
}

function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="card overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead className="border-b bg-surface/60 text-xs uppercase text-ink-muted">
          <tr>
            {head.map((h) => (
              <th key={h} className="px-4 py-3 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">{children}</tbody>
      </table>
    </div>
  );
}

const td = 'px-4 py-3 align-top';
const todayIST = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

// --- Dashboard ----------------------------------------------------------------

interface Stats {
  today: { date: string; revenuePaise: number; bookings: number; seats: number };
  last7Days: { date: string; revenuePaise: number; bookings: number }[];
  inventory: { movies: number; theatres: number; screens: number; upcoming: number };
}

export function AdminDashboard() {
  const { data } = useAdmin<Stats>(['stats'], '/admin/stats');
  const sync = useAdminMutation(
    () => api<{ synced: number }>('/admin/movies/sync', { method: 'POST' }),
    'Movies synced from TMDB',
  );
  const schedule = useAdminMutation(
    () => api<{ created: number }>('/admin/showtimes/auto-schedule', { method: 'POST', body: { days: 7 } }),
    'Schedule filled for the next 7 days',
  );
  const max = Math.max(1, ...(data?.last7Days.map((d) => d.revenuePaise) ?? [1]));

  return (
    <Page
      title="Dashboard"
      actions={
        <div className="flex flex-wrap gap-2">
          <button className="btn-outline" onClick={() => sync.mutate(undefined)} disabled={sync.isPending}>
            {sync.isPending ? <Spinner /> : <RefreshCw className="h-4 w-4" />} Sync from TMDB
          </button>
          <button className="btn-primary" onClick={() => schedule.mutate(undefined)} disabled={schedule.isPending}>
            {schedule.isPending ? <Spinner /> : <CalendarPlus className="h-4 w-4" />} Auto-schedule 7 days
          </button>
        </div>
      }
    >
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {[
          ["Today's revenue", data ? formatINR(data.today.revenuePaise) : '—'],
          ['Bookings today', data?.today.bookings ?? '—'],
          ['Seats sold today', data?.today.seats ?? '—'],
          ['Upcoming shows', data?.inventory.upcoming ?? '—'],
        ].map(([label, value]) => (
          <div key={label} className="card p-4">
            <p className="text-xs uppercase text-ink-muted">{label}</p>
            <p className="mt-1 text-2xl font-bold">{value}</p>
          </div>
        ))}
      </div>

      <section className="card mt-6 p-5">
        <h2 className="mb-4 font-semibold">Revenue, last 7 days</h2>
        <div className="flex h-40 items-end gap-3" role="img" aria-label="Revenue per day for the last 7 days">
          {data?.last7Days.map((d) => (
            <div key={d.date} className="flex h-full flex-1 flex-col items-center gap-1">
              <span className="text-[10px] text-ink-muted">{d.revenuePaise ? formatINR(d.revenuePaise) : ''}</span>
              <div className="flex w-full flex-1 items-end">
                <div className="w-full rounded-t bg-brand/80" style={{ height: `${(d.revenuePaise / max) * 100}%`, minHeight: 2 }} />
              </div>
              <span className="text-[10px] text-ink-muted">{d.date.slice(5)}</span>
            </div>
          ))}
        </div>
      </section>

      {data && (
        <p className="mt-4 text-sm text-ink-muted">
          {data.inventory.movies} movies · {data.inventory.theatres} theatres · {data.inventory.screens} screens
        </p>
      )}
    </Page>
  );
}

// --- Theatres -----------------------------------------------------------------

interface TheatreRow {
  id: string;
  name: string;
  address: string;
  city: string;
  cityId: string;
  amenities: string[];
  screenCount: number;
}

export function AdminTheatres() {
  const { data } = useAdmin<{ theatres: TheatreRow[] }>(['theatres'], '/admin/theatres');
  const { data: cities } = useCities();
  const create = useAdminMutation((body: object) => api('/admin/theatres', { method: 'POST', body }), 'Theatre added');
  const remove = useAdminMutation((id: string) => api(`/admin/theatres/${id}`, { method: 'DELETE' }), 'Theatre deleted');

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    create.mutate({
      cityId: f.get('cityId'),
      name: f.get('name'),
      address: f.get('address'),
      amenities: String(f.get('amenities') ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    });
    e.currentTarget.reset();
  };

  return (
    <Page title="Theatres">
      <form onSubmit={onSubmit} className="card mb-6 grid gap-3 p-4 md:grid-cols-[160px_1fr_1fr_1fr_auto]">
        <select name="cityId" required className="input" aria-label="City">
          {cities?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <input name="name" required minLength={2} placeholder="Theatre name" className="input" />
        <input name="address" required minLength={2} placeholder="Address" className="input" />
        <input name="amenities" placeholder="Amenities (comma separated)" className="input" />
        <button className="btn-primary" disabled={create.isPending}>
          Add
        </button>
      </form>
      <Table head={['Theatre', 'City', 'Screens', 'Amenities', '']}>
        {data?.theatres.map((t) => (
          <tr key={t.id}>
            <td className={td}>
              <p className="font-medium">{t.name}</p>
              <p className="text-xs text-ink-muted">{t.address}</p>
            </td>
            <td className={td}>{t.city}</td>
            <td className={td}>{t.screenCount}</td>
            <td className={td}>{t.amenities.join(', ')}</td>
            <td className={td}>
              <button
                className="btn-ghost p-2 text-red-600"
                aria-label={`Delete ${t.name}`}
                onClick={() => confirm(`Delete ${t.name}?`) && remove.mutate(t.id)}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </td>
          </tr>
        ))}
      </Table>
    </Page>
  );
}

// --- Screens ------------------------------------------------------------------

interface ScreenRow {
  id: string;
  name: string;
  theatre: string;
  city: string;
  seatCount: number;
  layout: { rows: number; cols: number; formats?: string[] };
  tiers: { id: string; name: string; pricePaise: number }[];
}

export function AdminScreens() {
  const { data } = useAdmin<{ screens: ScreenRow[] }>(['screens'], '/admin/screens');
  const { data: theatres } = useAdmin<{ theatres: TheatreRow[] }>(['theatres'], '/admin/theatres');
  const create = useAdminMutation((body: object) => api('/admin/screens', { method: 'POST', body }), 'Screen created');
  const remove = useAdminMutation((id: string) => api(`/admin/screens/${id}`, { method: 'DELETE' }), 'Screen deleted');
  const [tiers, setTiers] = useState('Recliner:450:2\nPrime:250:6\nClassic:180:4');

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const parsed = tiers
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const [name, rupees, rows] = l.split(':').map((s) => s.trim());
        return { name, pricePaise: Math.round(Number(rupees) * 100), rows: Number(rows) };
      });
    create.mutate({
      theatreId: f.get('theatreId'),
      name: f.get('name'),
      cols: Number(f.get('cols')),
      tiers: parsed,
      aisles: String(f.get('aisles') ?? '')
        .split(',')
        .map((s) => Number(s.trim()))
        .filter(Boolean),
      blocked: String(f.get('blocked') ?? '')
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean),
      formats: f.getAll('formats'),
    });
  };

  return (
    <Page title="Screens & seat layouts">
      <form onSubmit={onSubmit} className="card mb-6 grid gap-4 p-4 md:grid-cols-2">
        <div className="space-y-3">
          <select name="theatreId" required className="input" aria-label="Theatre">
            {theatres?.theatres.map((t) => (
              <option key={t.id} value={t.id}>
                {t.city} — {t.name}
              </option>
            ))}
          </select>
          <input name="name" required placeholder="Screen name, e.g. Audi 3" className="input" />
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm">
              Seats per row
              <input name="cols" type="number" min={4} max={30} defaultValue={14} className="input mt-1" />
            </label>
            <label className="text-sm">
              Aisle after columns
              <input name="aisles" placeholder="4, 10" className="input mt-1" />
            </label>
          </div>
          <input name="blocked" placeholder="Blocked seats, e.g. A1, A14" className="input" />
          <fieldset className="flex flex-wrap gap-3 text-sm">
            <legend className="mb-1 text-sm font-medium">Formats</legend>
            {FORMATS.map((f) => (
              <label key={f} className="flex items-center gap-1">
                <input type="checkbox" name="formats" value={f} defaultChecked={f === '2D'} /> {f}
              </label>
            ))}
          </fieldset>
        </div>
        <div className="flex flex-col gap-3">
          <label className="text-sm">
            Tiers, back of hall first — <code>name:price₹:rows</code>
            <textarea value={tiers} onChange={(e) => setTiers(e.target.value)} rows={5} className="input mt-1 font-mono" />
          </label>
          <button className="btn-primary mt-auto" disabled={create.isPending}>
            Create screen
          </button>
        </div>
      </form>
      <Table head={['Screen', 'Theatre', 'Layout', 'Tiers', '']}>
        {data?.screens.map((s) => (
          <tr key={s.id}>
            <td className={td}>
              <p className="font-medium">{s.name}</p>
              <p className="text-xs text-ink-muted">{s.layout.formats?.join(' / ')}</p>
            </td>
            <td className={td}>
              {s.theatre}
              <p className="text-xs text-ink-muted">{s.city}</p>
            </td>
            <td className={td}>
              {s.layout.rows}×{s.layout.cols} · {s.seatCount} seats
            </td>
            <td className={td}>{s.tiers.map((t) => `${t.name} ${formatINR(t.pricePaise)}`).join(', ')}</td>
            <td className={td}>
              <button
                className="btn-ghost p-2 text-red-600"
                aria-label={`Delete ${s.name}`}
                onClick={() => confirm(`Delete ${s.name}?`) && remove.mutate(s.id)}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </td>
          </tr>
        ))}
      </Table>
    </Page>
  );
}

// --- Showtimes ----------------------------------------------------------------

interface ShowtimeRow {
  id: string;
  startsAt: string;
  format: string;
  language: string;
  status: string;
  movie: string;
  screen: string;
  theatre: string;
  city: string;
  booked: number;
  capacity: number;
}

export function AdminShowtimes() {
  const [date, setDate] = useState(todayIST());
  const { data, isLoading } = useAdmin<{ showtimes: ShowtimeRow[] }>(['showtimes', date], `/admin/showtimes?date=${date}`);
  const { data: screens } = useAdmin<{ screens: ScreenRow[] }>(['screens'], '/admin/screens');
  const { data: movies } = useQuery({
    queryKey: ['movies', { status: 'now_showing', limit: 60 }],
    queryFn: () => api<{ movies: MovieSummary[] }>('/movies?status=now_showing&limit=60').then((r) => r.movies),
  });
  const create = useAdminMutation((body: object) => api('/admin/showtimes', { method: 'POST', body }), 'Showtime created');
  const cancel = useAdminMutation((id: string) => api(`/admin/showtimes/${id}/cancel`, { method: 'POST' }), 'Showtime cancelled');

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const local = String(f.get('startsAt')); // datetime-local, interpreted as IST
    create.mutate({
      movieId: f.get('movieId'),
      screenId: f.get('screenId'),
      startsAt: `${local}:00+05:30`,
      language: f.get('language'),
      format: f.get('format'),
    });
  };

  return (
    <Page title="Showtimes">
      <form onSubmit={onSubmit} className="card mb-6 grid gap-3 p-4 md:grid-cols-3 lg:grid-cols-[1fr_1fr_190px_120px_100px_auto]">
        <select name="movieId" required className="input" aria-label="Movie">
          {movies?.map((m) => (
            <option key={m.id} value={m.id}>
              {m.title}
            </option>
          ))}
        </select>
        <select name="screenId" required className="input" aria-label="Screen">
          {screens?.screens.map((s) => (
            <option key={s.id} value={s.id}>
              {s.city} · {s.theatre} · {s.name}
            </option>
          ))}
        </select>
        <input name="startsAt" type="datetime-local" required className="input" aria-label="Start time (IST)" />
        <input name="language" required defaultValue="Hindi" className="input" aria-label="Language" />
        <select name="format" className="input" aria-label="Format">
          {FORMATS.map((f) => (
            <option key={f}>{f}</option>
          ))}
        </select>
        <button className="btn-primary" disabled={create.isPending}>
          Add
        </button>
      </form>

      <div className="mb-3 flex items-center gap-2">
        <label htmlFor="st-date" className="text-sm font-medium">
          Date
        </label>
        <input id="st-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input w-auto" />
      </div>
      {isLoading ? (
        <Spinner />
      ) : !data?.showtimes.length ? (
        <EmptyState title="No showtimes on this date" />
      ) : (
        <Table head={['Time', 'Movie', 'Where', 'Format', 'Sold', '']}>
          {data.showtimes.map((s) => (
            <tr key={s.id} className={clsx(s.status === 'CANCELLED' && 'opacity-50')}>
              <td className={td}>{fmtTime(s.startsAt)}</td>
              <td className={td}>{s.movie}</td>
              <td className={td}>
                {s.theatre} · {s.screen}
                <p className="text-xs text-ink-muted">{s.city}</p>
              </td>
              <td className={td}>
                {s.format} · {s.language}
              </td>
              <td className={td}>
                {s.booked}/{s.capacity}
              </td>
              <td className={td}>
                {s.status === 'SCHEDULED' ? (
                  <button className="text-sm text-red-600 hover:underline" onClick={() => confirm('Cancel this show?') && cancel.mutate(s.id)}>
                    Cancel
                  </button>
                ) : (
                  <span className="text-xs">Cancelled</span>
                )}
              </td>
            </tr>
          ))}
        </Table>
      )}
    </Page>
  );
}

// --- Bookings -----------------------------------------------------------------

interface AdminBooking {
  id: string;
  code: string;
  status: string;
  seatCount: number;
  totalPaise: number;
  createdAt: string;
  email: string;
  userName: string;
  movie: string;
  startsAt: string;
  theatre: string;
  city: string;
}

export function AdminBookings() {
  const [status, setStatus] = useState('');
  const [date, setDate] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const params = new URLSearchParams({ page: String(page) });
  if (status) params.set('status', status);
  if (date) params.set('date', date);
  if (q.trim()) params.set('q', q.trim());
  const { data, isLoading } = useAdmin<{ bookings: AdminBooking[]; total: number; pageSize: number }>(
    ['bookings', params.toString()],
    `/admin/bookings?${params}`,
  );
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <Page title="Bookings">
      <div className="mb-4 flex flex-wrap gap-2">
        <input
          value={q}
          onChange={(e) => (setQ(e.target.value), setPage(1))}
          placeholder="Code, email or movie"
          className="input w-56"
          aria-label="Search bookings"
        />
        <select value={status} onChange={(e) => (setStatus(e.target.value), setPage(1))} className="input w-auto" aria-label="Status">
          <option value="">All statuses</option>
          {BOOKING_STATUSES.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <input
          type="date"
          value={date}
          onChange={(e) => (setDate(e.target.value), setPage(1))}
          className="input w-auto"
          aria-label="Booked on"
        />
      </div>
      {isLoading ? (
        <Spinner />
      ) : !data?.bookings.length ? (
        <EmptyState title="No bookings match" />
      ) : (
        <>
          <Table head={['Code', 'Customer', 'Show', 'Seats', 'Amount', 'Status', 'Booked']}>
            {data.bookings.map((b) => (
              <tr key={b.id}>
                <td className={`${td} font-mono`}>{b.code}</td>
                <td className={td}>
                  {b.userName}
                  <p className="text-xs text-ink-muted">{b.email}</p>
                </td>
                <td className={td}>
                  {b.movie}
                  <p className="text-xs text-ink-muted">
                    {b.theatre}, {b.city} · {fmtDateTime(b.startsAt)}
                  </p>
                </td>
                <td className={td}>{b.seatCount}</td>
                <td className={td}>{formatINR(b.totalPaise)}</td>
                <td className={td}>{b.status}</td>
                <td className={td}>{fmtDateTime(b.createdAt)}</td>
              </tr>
            ))}
          </Table>
          <div className="mt-4 flex items-center justify-end gap-2 text-sm">
            <button className="btn-ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </button>
            <span>
              Page {page} of {pages} · {data.total} bookings
            </span>
            <button className="btn-ghost" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
              Next
            </button>
          </div>
        </>
      )}
    </Page>
  );
}
