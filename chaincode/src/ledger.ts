import type { Context } from 'fabric-contract-api';
import type { Iterators, Timestamp } from 'fabric-shim';
import { notFound } from './errors';

/** World-state keys. Simple prefixed keys (not composite) so CouchDB rich queries can see them. */
export const KEYS = {
  parcel: (id: string) => `PARCEL_${id}`,
  title: (titleNumber: string) => `TITLE_${titleNumber}`,
  transfer: (id: string) => `TRANSFER_${id}`,
  encumbrance: (id: string) => `ENCUMBRANCE_${id}`,
  dispute: (id: string) => `DISPUTE_${id}`,
  document: (id: string) => `DOCUMENT_${id}`,
} as const;

export const PRIVATE_COLLECTION = 'transferPrivate';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * JSON with keys sorted at every level, so every endorsing peer produces byte-identical state
 * regardless of object construction order (rule 6: no unordered map iteration).
 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = sortDeep((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

export const toBytes = (value: unknown): Uint8Array => encoder.encode(stableStringify(value));
export const fromBytes = <T>(bytes: Uint8Array): T => JSON.parse(decoder.decode(bytes)) as T;

export async function readState<T>(ctx: Context, key: string): Promise<T | null> {
  const bytes = await ctx.stub.getState(key);
  if (!bytes || bytes.length === 0) return null;
  return fromBytes<T>(bytes);
}

export async function mustRead<T>(ctx: Context, key: string, message: string): Promise<T> {
  const value = await readState<T>(ctx, key);
  if (value === null) throw notFound(message);
  return value;
}

export async function writeState(ctx: Context, key: string, value: unknown): Promise<void> {
  await ctx.stub.putState(key, toBytes(value));
}

/** Transaction time as ISO-8601 — identical on every endorser (rule 6: never Date.now()). */
export function txTime(ctx: Context): string {
  return timestampToIso(ctx.stub.getTxTimestamp());
}

export function timestampToIso(ts: Timestamp): string {
  // seconds is a protobuf Long; String() works for Long and plain numbers alike.
  const seconds = Number(String(ts.seconds));
  return new Date(seconds * 1000 + Math.floor(ts.nanos / 1_000_000)).toISOString();
}

/** Deterministic entity ID derived from the transaction ID, e.g. TRF-9F86D081884C7D65. */
export function newId(ctx: Context, prefix: 'TRF' | 'ENC' | 'DSP' | 'DOC'): string {
  return `${prefix}-${ctx.stub.getTxID().slice(0, 16).toUpperCase()}`;
}

export interface MilkiEvent {
  entity: string;
  action: string;
  id: string;
  parcelId: string;
  status: string;
  txId: string;
  timestamp: string;
  actor: { id: string; mspId: string; role: string | null };
  data?: Record<string, string | number | boolean | null>;
}

/** Emits `milki.<Entity>.<Action>`. Fabric keeps one event per transaction, so call this once, last. */
export function emit(ctx: Context, event: Omit<MilkiEvent, 'txId' | 'timestamp'>): void {
  const full: MilkiEvent = { ...event, txId: ctx.stub.getTxID(), timestamp: txTime(ctx) };
  ctx.stub.setEvent(`milki.${event.entity}.${event.action}`, toBytes(full));
}

/** Drains a Fabric iterator (shim iterators are not reliably async-iterable across versions). */
export async function drain<T>(iterator: Iterators.CommonIterator<T>): Promise<T[]> {
  const out: T[] = [];
  try {
    let res = await iterator.next();
    while (!res.done) {
      if (res.value) out.push(res.value);
      res = await iterator.next();
    }
  } finally {
    await iterator.close();
  }
  return out;
}

export interface Page<T> {
  records: T[];
  fetchedRecordsCount: number;
  bookmark: string;
}

/** Runs a CouchDB rich query restricted to one docType. Only for read-only (evaluate) transactions. */
export async function queryPage<T>(
  ctx: Context,
  docType: string,
  selector: Record<string, unknown>,
  sort: Record<string, 'asc' | 'desc'>[] | undefined,
  size: number,
  bookmark: string,
): Promise<Page<T>> {
  const query = stableStringify(sort ? { selector: { ...selector, docType }, sort } : { selector: { ...selector, docType } });
  const { iterator, metadata } = await ctx.stub.getQueryResultWithPagination(query, size, bookmark);
  const rows = await drain<Iterators.KV>(iterator);
  return {
    records: rows.map((r) => fromBytes<T>(r.value)),
    fetchedRecordsCount: metadata.fetchedRecordsCount,
    bookmark: metadata.bookmark,
  };
}
