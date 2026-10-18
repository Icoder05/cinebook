import type { ApiErrorBody, AuthResponse, User } from '@cinebook/shared';

const BASE = `${import.meta.env.VITE_API_URL ?? ''}/api/v1`;

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

// --- Auth state: the access token lives only in memory, never in storage. ---

type AuthStatus = 'loading' | 'authed' | 'guest';
interface AuthState {
  status: AuthStatus;
  user: User | null;
}

let accessToken: string | null = null;
let tokenExp = 0;
let state: AuthState = { status: 'loading', user: null };
const listeners = new Set<() => void>();

export const authStore = {
  get: () => state,
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

function setState(next: AuthState) {
  state = next;
  listeners.forEach((l) => l());
}

function decodeExp(token: string): number {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return (payload.exp ?? 0) * 1000;
  } catch {
    return 0;
  }
}

export function setSession(res: AuthResponse) {
  accessToken = res.accessToken;
  tokenExp = decodeExp(res.accessToken);
  setState({ status: 'authed', user: res.user });
}

export function setUser(user: User) {
  setState({ status: 'authed', user });
}

export function clearSession() {
  accessToken = null;
  tokenExp = 0;
  setState({ status: 'guest', user: null });
}

let refreshing: Promise<boolean> | null = null;

/** Silent refresh via the httpOnly cookie. Concurrent callers share one request. */
export function refreshSession(): Promise<boolean> {
  refreshing ??= (async () => {
    try {
      const call = () => fetch(`${BASE}/auth/refresh`, { method: 'POST', credentials: 'include' });
      let res = await call();
      if (res.status === 401) {
        const body = (await res.clone().json().catch(() => null)) as ApiErrorBody | null;
        // Another tab rotated the cookie a moment ago; the browser now holds the new one.
        if (body?.error.code === 'REFRESH_RACE') {
          await new Promise((r) => setTimeout(r, 300));
          res = await call();
        }
      }
      if (!res.ok) {
        clearSession();
        return false;
      }
      setSession((await res.json()) as AuthResponse);
      return true;
    } catch {
      clearSession();
      return false;
    } finally {
      setTimeout(() => (refreshing = null), 0);
    }
  })();
  return refreshing;
}

// --- Fetch wrapper -----------------------------------------------------------

interface Options {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** Internal: whether a 401 may trigger one refresh + retry. */
  retry?: boolean;
}

export async function api<T>(path: string, opts: Options = {}): Promise<T> {
  const { method = 'GET', body, headers = {}, signal, retry = true } = opts;

  // Refresh proactively if the token is about to expire.
  if (accessToken && tokenExp && tokenExp - Date.now() < 30_000) await refreshSession();

  const res = await fetch(BASE + path, {
    method,
    signal,
    credentials: 'include',
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && retry && !path.startsWith('/auth/')) {
    // One refresh, one retry (PRD §6: "client then calls /auth/refresh once").
    if (await refreshSession()) return api<T>(path, { ...opts, retry: false });
  }

  if (!res.ok) {
    let payload: ApiErrorBody | null = null;
    try {
      payload = (await res.json()) as ApiErrorBody;
    } catch {
      /* non-JSON error */
    }
    throw new ApiError(
      res.status,
      payload?.error.code ?? 'HTTP_ERROR',
      payload?.error.message ?? `Request failed (${res.status})`,
      payload?.error.details,
    );
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const isAuthed = () => state.status === 'authed';
