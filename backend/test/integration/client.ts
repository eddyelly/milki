/** Shared helpers for integration tests: a tiny API client, Mailpit OTP reader and T3 call wrapper. */
import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';

export const API = process.env.API_URL ?? 'http://localhost:4100/api/v1';
export const MAILPIT = process.env.MAILPIT_URL ?? 'http://localhost:8126';
export const PASSWORD = 'Milki@2026';

export interface Envelope<T> {
  data: T;
  meta: Record<string, unknown> | null;
  error?: { code: string; message: string };
}

export async function call<T>(method: string, path: string, opts: { token?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      ...opts.headers,
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  return { status: res.status, body: (await res.json()) as Envelope<T> };
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Reads the newest SMS-to-email for a phone from Mailpit and extracts the 6-digit code. */
export async function otpFor(phone: string, after: number): Promise<string> {
  const to = `${phone.replace('+', '')}@sms.milki.local`;
  for (let i = 0; i < 40; i++) {
    const list = (await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}&limit=1`)).json()) as {
      messages: { ID: string; Created: string; Snippet: string }[];
    };
    const m = list.messages[0];
    if (m && new Date(m.Created).getTime() >= after) {
      const code = m.Snippet.match(/\b(\d{6})\b/)?.[1];
      if (code) return code;
    }
    await sleep(250);
  }
  throw new Error(`no OTP for ${phone}`);
}

export async function signIn(identifier: string, phone: string) {
  const t0 = Date.now() - 1000;
  const step1 = await call<{ challengeId: string }>('POST', '/auth/login', { body: { identifier, password: PASSWORD } });
  expect(step1.status).toBe(200);
  const step2 = await call<{ accessToken: string; user: { userId: string; role: string } }>('POST', '/auth/otp/verify', {
    body: { challengeId: step1.body.data.challengeId, code: await otpFor(phone, t0) },
  });
  expect(step2.status).toBe(200);
  return step2.body.data;
}

export async function reauth(token: string): Promise<string> {
  const r = await call<{ reauthToken: string }>('POST', '/auth/reauth', { token, body: { password: PASSWORD } });
  expect(r.status).toBe(200);
  return r.body.data.reauthToken;
}

export async function t3(method: string, path: string, token: string, body: unknown) {
  return call<{ txId: string; status: string }>(method, path, {
    token,
    body,
    headers: { 'idempotency-key': `it-${randomUUID()}`, 'x-reauth-token': await reauth(token) },
  });
}


/** Polls GET /ledger/tx/:txId until the transaction is committed (fallback to the socket event). */
export async function waitCommitted(token: string, txId: string): Promise<number> {
  for (let i = 0; i < 120; i++) {
    const r = await call<{ status: string; blockNumber: number }>('GET', `/ledger/tx/${txId}`, { token });
    if (r.body.data?.status === 'COMMITTED') return r.body.data.blockNumber;
    if (r.body.data?.status === 'FAILED') throw new Error(`tx ${txId} failed`);
    await sleep(250);
  }
  throw new Error(`tx ${txId} not committed in time`);
}

/** Multipart T3 upload (POST /documents or /documents/:id/supersede). */
export async function uploadDoc(token: string, path: string, fields: Record<string, string>, file: Buffer, filename: string, mime: string) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  form.append('file', new Blob([new Uint8Array(file)], { type: mime }), filename);
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'idempotency-key': `it-${randomUUID()}`, 'x-reauth-token': await reauth(token) },
    body: form,
  });
  return { status: res.status, body: (await res.json()) as Envelope<{ txId: string; documentId: string; sha256: string }> };
}
