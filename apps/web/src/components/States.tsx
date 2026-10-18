import { AlertCircle, Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, Navigate, Outlet, isRouteErrorResponse, useLocation, useRouteError } from 'react-router-dom';
import { ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';

export function Spinner({ className = 'h-5 w-5' }: { className?: string }) {
  return <Loader2 className={`animate-spin ${className}`} aria-hidden />;
}

export function PageSpinner() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center text-brand" role="status" aria-label="Loading">
      <Spinner className="h-8 w-8" />
    </div>
  );
}

export function ErrorState({ error, action }: { error: unknown; action?: ReactNode }) {
  const notFound = error instanceof ApiError && error.status === 404;
  const message = error instanceof Error ? error.message : 'Something went wrong';
  return (
    <div className="container-page flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
      <AlertCircle className="h-10 w-10 text-brand" aria-hidden />
      <h1 className="text-xl font-semibold">{notFound ? 'Not found' : 'Something went wrong'}</h1>
      <p className="max-w-md text-ink-muted">{message}</p>
      {action ?? (
        <Link to="/" className="btn-primary">
          Back to home
        </Link>
      )}
    </div>
  );
}

export function RouteError() {
  const err = useRouteError();
  const message = isRouteErrorResponse(err) ? `${err.status} ${err.statusText}` : (err as Error)?.message;
  return <ErrorState error={new Error(message || 'Unexpected error')} />;
}

export function NotFound() {
  return <ErrorState error={new ApiError(404, 'NOT_FOUND', "We couldn't find that page.")} />;
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center gap-2 px-6 py-12 text-center">
      <p className="text-lg font-medium">{title}</p>
      {children && <div className="text-sm text-ink-muted">{children}</div>}
    </div>
  );
}

/** Route guards. */
export function RequireAuth() {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <PageSpinner />;
  if (status === 'guest') return <Navigate to="/login" replace state={{ from: location }} />;
  return <Outlet />;
}

export function RequireAdmin() {
  const { status, user } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <PageSpinner />;
  if (status === 'guest') return <Navigate to="/login" replace state={{ from: location }} />;
  if (user?.role !== 'admin') return <ErrorState error={new Error('Admins only.')} />;
  return <Outlet />;
}
