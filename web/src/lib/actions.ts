'use client';

import type { ConfirmContext } from '@/components/confirm-action';
import { http, send } from './api';
import type { Submitted } from './types';

/** A T3 ledger write: carries the dialog's idempotency key and the single-use re-auth token. */
export function ledgerWrite(method: 'post' | 'patch', url: string, body: unknown, ctx: ConfirmContext): Promise<Submitted> {
  return send<Submitted>(method, url, body, { idempotencyKey: ctx.idempotencyKey, reauthToken: ctx.reauthToken });
}

/** Multipart T3 upload (documents). */
export async function ledgerUpload(url: string, form: FormData, ctx: ConfirmContext): Promise<Submitted> {
  const headers: Record<string, string> = { 'Idempotency-Key': ctx.idempotencyKey };
  if (ctx.reauthToken) headers['X-Reauth-Token'] = ctx.reauthToken;
  const r = await http.post<{ data: Submitted }>(url, form, { headers });
  return r.data.data;
}

export async function sha256Hex(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Downloads a document. The API re-hashes the stored bytes against the ledger first (X-Ledger-Verified);
 * we confirm that header before saving the file.
 */
export async function downloadDocument(documentId: string, fallbackName: string): Promise<{ verified: boolean }> {
  const r = await http.get<Blob>(`/documents/${documentId}/download`, { responseType: 'blob' });
  const verified = r.headers['x-ledger-verified'] === 'true';
  const disposition = String(r.headers['content-disposition'] ?? '');
  const name = /filename="([^"]+)"/.exec(disposition)?.[1] ?? fallbackName;
  const url = URL.createObjectURL(r.data);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return { verified };
}
