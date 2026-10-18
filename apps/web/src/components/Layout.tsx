import { ChevronDown, LogOut, Shield, Ticket, User as UserIcon } from 'lucide-react';
import { Suspense, useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, ScrollRestoration, useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { logout, useAuth } from '../lib/auth';
import { useCity } from '../lib/city';
import { CityPicker } from './CityPicker';
import { SearchBox } from './SearchBox';
import { PageSpinner } from './States';

function UserMenu() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const onDoc = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  if (!user) return null;
  const item = 'flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm hover:bg-surface';
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-full py-1 pl-1 pr-2 text-sm text-white hover:bg-white/10"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand font-semibold">
          {user.name.charAt(0).toUpperCase()}
        </span>
        <span className="hidden max-w-[120px] truncate sm:inline">Hi, {user.name.split(' ')[0]}</span>
        <ChevronDown className="h-4 w-4" aria-hidden />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-40 mt-2 w-56 overflow-hidden rounded-xl bg-white py-1 text-ink-2 shadow-xl">
          <div className="border-b px-4 py-3">
            <p className="truncate text-sm font-medium">{user.name}</p>
            <p className="truncate text-xs text-ink-muted">{user.email}</p>
          </div>
          <Link role="menuitem" to="/bookings" className={item} onClick={() => setOpen(false)}>
            <Ticket className="h-4 w-4" /> My bookings
          </Link>
          <Link role="menuitem" to="/profile" className={item} onClick={() => setOpen(false)}>
            <UserIcon className="h-4 w-4" /> Profile
          </Link>
          {user.role === 'admin' && (
            <Link role="menuitem" to="/admin" className={item} onClick={() => setOpen(false)}>
              <Shield className="h-4 w-4" /> Admin
            </Link>
          )}
          <button
            role="menuitem"
            className={`${item} border-t text-red-600`}
            onClick={async () => {
              setOpen(false);
              await logout();
              toast.success('Signed out');
              navigate('/');
            }}
          >
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

function Header() {
  const { status } = useAuth();
  const { city, hasChosen, cities } = useCity();
  const [pickerOpen, setPickerOpen] = useState(false);
  const location = useLocation();

  // First visit: ask for a city once (the first seeded city is used meanwhile).
  useEffect(() => {
    if (!hasChosen && cities.length > 1 && location.pathname === '/') setPickerOpen(true);
  }, [hasChosen, cities.length, location.pathname]);

  return (
    <header className="sticky top-0 z-30 bg-ink shadow">
      <div className="container-page flex h-14 items-center gap-3 md:h-16 md:gap-6">
        <Link to="/" className="flex shrink-0 items-center gap-1.5 text-white" aria-label="CineBook home">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand">
            <Ticket className="h-5 w-5" aria-hidden />
          </span>
          <span className="text-lg font-bold tracking-tight">
            cine<span className="text-brand">book</span>
          </span>
        </Link>
        <SearchBox className="hidden flex-1 md:block md:max-w-xl" />
        <div className="ml-auto flex items-center gap-2 md:gap-4">
          <button
            onClick={() => setPickerOpen(true)}
            className="flex items-center gap-1 text-sm text-white/90 hover:text-white"
            aria-label={`City: ${city?.name ?? 'choose'}. Change city`}
          >
            {city?.name ?? 'Select city'}
            <ChevronDown className="h-4 w-4" aria-hidden />
          </button>
          {status === 'authed' ? (
            <UserMenu />
          ) : status === 'guest' ? (
            <Link to="/login" state={{ from: location }} className="btn-primary px-3 py-1.5">
              Sign in
            </Link>
          ) : (
            <span className="skeleton h-8 w-16 bg-white/20" />
          )}
        </div>
      </div>
      <div className="container-page pb-2 md:hidden">
        <SearchBox />
      </div>
      <CityPicker open={pickerOpen} onClose={() => setPickerOpen(false)} />
    </header>
  );
}

function Footer() {
  return (
    <footer className="mt-16 bg-ink-2 text-gray-400">
      <div className="container-page flex flex-col gap-3 py-8 text-sm md:flex-row md:items-center md:justify-between">
        <p>
          <span className="font-semibold text-white">CineBook</span> — a portfolio BookMyShow clone. Test mode: no real
          payments.
        </p>
        <p>
          Movie data from{' '}
          <a href="https://www.themoviedb.org" className="underline hover:text-white" target="_blank" rel="noreferrer">
            TMDB
          </a>
          . This product uses the TMDB API but is not endorsed or certified by TMDB.
        </p>
      </div>
    </footer>
  );
}

export function Layout() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex-1">
        <Suspense fallback={<PageSpinner />}>
          <Outlet />
        </Suspense>
      </main>
      <Footer />
      <ScrollRestoration />
    </div>
  );
}

/** Minimal chrome for the payment gateway page. */
export function BareLayout() {
  return (
    <div className="min-h-screen bg-slate-100">
      <Suspense fallback={<PageSpinner />}>
        <Outlet />
      </Suspense>
      <ScrollRestoration />
    </div>
  );
}

export function AdminNav() {
  const tabs = [
    ['/admin', 'Dashboard'],
    ['/admin/theatres', 'Theatres'],
    ['/admin/screens', 'Screens'],
    ['/admin/showtimes', 'Showtimes'],
    ['/admin/bookings', 'Bookings'],
  ] as const;
  return (
    <nav className="no-scrollbar -mx-4 mb-6 flex gap-1 overflow-x-auto border-b px-4" aria-label="Admin">
      {tabs.map(([to, label]) => (
        <NavLink
          key={to}
          to={to}
          end
          className={({ isActive }) =>
            `whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium ${
              isActive ? 'border-brand text-brand' : 'border-transparent text-ink-muted hover:text-ink'
            }`
          }
        >
          {label}
        </NavLink>
      ))}
    </nav>
  );
}
