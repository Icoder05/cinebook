import { useSyncExternalStore } from 'react';
import type { AuthResponse, LoginInput, SignupInput } from '@cinebook/shared';
import { api, authStore, clearSession, setSession } from './api';
import { queryClient } from './queryClient';

export function useAuth() {
  return useSyncExternalStore(authStore.subscribe, authStore.get);
}

export async function login(input: LoginInput) {
  setSession(await api<AuthResponse>('/auth/login', { method: 'POST', body: input }));
}

export async function signup(input: SignupInput) {
  setSession(await api<AuthResponse>('/auth/signup', { method: 'POST', body: input }));
}

export async function logout(all = false) {
  try {
    await api(all ? '/auth/logout-all' : '/auth/logout', { method: 'POST' });
  } finally {
    clearSession();
    queryClient.removeQueries({ queryKey: ['bookings'] });
    queryClient.removeQueries({ queryKey: ['admin'] });
  }
}
