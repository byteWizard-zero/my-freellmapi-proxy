const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

const TOKEN_KEY = 'freellmapi_dashboard_token';
export const UNAUTHORIZED_EVENT = 'freellmapi:unauthorized';

export function getToken(): string | null {
  try {
    // Clear legacy localStorage token if present
    localStorage.removeItem(TOKEN_KEY);
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string): void {
  try {
    sessionStorage.setItem(TOKEN_KEY, token);
  } catch {
    // sessionStorage unavailable
  }
}

export function clearToken(): void {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    // storage unavailable
  }
}

export interface ApiError extends Error {
  status?: number;
  code?: string;
}

export async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const token = getToken();
  const headers = new Headers(options?.headers);

  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: { message: res.statusText } }));

    // If the server says auth is invalid, purge token and notify the app
    if (res.status === 401 && body.error?.type === 'authentication_error') {
      clearToken();
      window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT));
    }

    const err = new Error(body.error?.message ?? `HTTP ${res.status}`) as ApiError;
    err.status = res.status;
    err.code = body.error?.type;
    throw err;
  }

  return res.json();
}
