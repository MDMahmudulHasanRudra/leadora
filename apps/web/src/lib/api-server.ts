import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { Identity } from './types';

const API = process.env.API_INTERNAL_URL ?? 'http://localhost:3001';

/** Server-side API call that forwards the browser's session cookie. */
export async function apiGet<T>(path: string): Promise<{ status: number; data: T | null }> {
  const cookieHeader = (await cookies()).toString();
  const res = await fetch(`${API}/api/v1${path}`, {
    headers: cookieHeader ? { cookie: cookieHeader } : {},
    cache: 'no-store',
    signal: AbortSignal.timeout(5000),
  });
  return { status: res.status, data: res.ok ? ((await res.json()) as T) : null };
}

export async function getIdentity(): Promise<Identity | null> {
  try {
    return (await apiGet<Identity>('/auth/me')).data;
  } catch {
    return null;
  }
}

/** Loads data for a protected page, sending the user to sign-in when the session is gone. */
export async function requireData<T>(path: string): Promise<T> {
  const { status, data } = await apiGet<T>(path);
  if (status === 401) redirect('/login');
  if (!data) throw new Error(`API ${path} failed with ${status}`);
  return data;
}
