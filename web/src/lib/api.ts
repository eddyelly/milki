import axios, { AxiosError, type AxiosRequestConfig, type InternalAxiosRequestConfig } from 'axios';
import type { Envelope, Session } from './types';

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4100/api/v1';
export const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL ?? 'http://localhost:4100';

/** Error with the API's human-readable message (CLAUDE.md §8: never show raw codes). */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  if (err instanceof AxiosError) {
    const body = err.response?.data as { error?: { code?: string; message?: string; details?: unknown } } | undefined;
    if (body?.error?.message) return new ApiError(err.response?.status ?? 0, body.error.code ?? 'ERROR', body.error.message, body.error.details);
    if (!err.response) return new ApiError(0, 'NETWORK', 'Milki could not be reached. Check your connection and try again.');
    return new ApiError(err.response.status, 'HTTP_ERROR', 'Something went wrong. Please try again.');
  }
  return new ApiError(0, 'UNKNOWN', err instanceof Error ? err.message : 'Something went wrong.');
}

// ------------------------------------------------------------------------------- access token
// Kept in memory only; the refresh token lives in an httpOnly cookie the browser sends to /auth.
let accessToken: string | null = null;
const listeners = new Set<(token: string | null) => void>();

export const getAccessToken = () => accessToken;
export function setAccessToken(token: string | null): void {
  accessToken = token;
  for (const l of listeners) l(token);
}
export function onAccessToken(l: (token: string | null) => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export const http = axios.create({ baseURL: API_URL, withCredentials: true, timeout: 45_000 });

const WRITE = new Set(['post', 'put', 'patch', 'delete']);

http.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  if (accessToken && !config.headers.Authorization) config.headers.Authorization = `Bearer ${accessToken}`;
  // Every write carries an Idempotency-Key (CLAUDE.md §8). Callers that may retry pass their own stable key.
  if (WRITE.has((config.method ?? '').toLowerCase()) && !config.headers['Idempotency-Key']) {
    config.headers['Idempotency-Key'] = crypto.randomUUID();
  }
  return config;
});

let refreshing: Promise<Session | null> | null = null;

/** Single-flight refresh using the httpOnly cookie. Resolves null when there is no valid session. */
export function refreshSession(): Promise<Session | null> {
  refreshing ??= axios
    .post<Envelope<Session>>(`${API_URL}/auth/refresh`, {}, { withCredentials: true })
    .then((r) => {
      setAccessToken(r.data.data.accessToken);
      return r.data.data;
    })
    .catch(() => {
      setAccessToken(null);
      return null;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

http.interceptors.response.use(undefined, async (error: AxiosError) => {
  const original = error.config as (AxiosRequestConfig & { _retried?: boolean }) | undefined;
  const code = (error.response?.data as { error?: { code?: string } } | undefined)?.error?.code;
  if (error.response?.status === 401 && code === 'UNAUTHORIZED' && original && !original._retried && !original.url?.includes('/auth/')) {
    original._retried = true;
    const session = await refreshSession();
    if (session) {
      original.headers = { ...original.headers, Authorization: `Bearer ${session.accessToken}` };
      return http(original);
    }
  }
  throw toApiError(error);
});

/** GET returning the envelope. */
export async function get<T>(url: string, params?: Record<string, unknown>): Promise<Envelope<T>> {
  const r = await http.get<Envelope<T>>(url, { params });
  return r.data;
}

export interface WriteOptions {
  idempotencyKey?: string;
  reauthToken?: string;
}

export async function send<T>(method: 'post' | 'patch' | 'delete', url: string, body?: unknown, opts: WriteOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
  if (opts.reauthToken) headers['X-Reauth-Token'] = opts.reauthToken;
  const r = await http.request<Envelope<T>>({ method, url, data: body, headers });
  return r.data.data;
}
