import { invalid } from './errors';

/** Plain JSON object (as parsed from a transaction argument). */
export type JsonObject = Record<string, unknown>;

export const SHA256_RE = /^[a-f0-9]{64}$/;
/** e.g. DSM-KIN-12-45 → region code, district code, block, plot. */
export const PARCEL_ID_RE = /^[A-Z]{2,4}-[A-Z]{2,4}-[0-9A-Z]{1,8}-[0-9A-Z]{1,8}$/;
/** Opaque Milki user / enrollment IDs. */
export const USER_ID_RE = /^[A-Za-z0-9._-]{3,64}$/;
export const ENTITY_ID_RE = /^(TRF|ENC|DSP|DOC)-[A-F0-9]{16}$/;
export const CURRENCY_RE = /^[A-Z]{3}$/;

export function parseObject(raw: string, what: string): JsonObject {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw invalid(`The ${what} is not valid JSON.`);
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw invalid(`The ${what} must be a JSON object.`);
  }
  return value as JsonObject;
}

/** Rejects any key not in `allowed` so callers cannot smuggle extra fields onto the ledger. */
export function onlyKeys(obj: JsonObject, allowed: readonly string[], what: string): void {
  const extra = Object.keys(obj).filter((k) => !allowed.includes(k));
  if (extra.length > 0) {
    throw invalid(`The ${what} contains fields that cannot be set: ${extra.sort().join(', ')}.`);
  }
}

interface StringRules {
  min?: number;
  max?: number;
  pattern?: RegExp;
  patternHint?: string;
}

export function str(value: unknown, field: string, rules: StringRules = {}): string {
  if (typeof value !== 'string') throw invalid(`${field} is required.`, { field });
  const v = value.trim();
  const min = rules.min ?? 1;
  const max = rules.max ?? 200;
  if (v.length < min) throw invalid(`${field} is required.`, { field });
  if (v.length > max) throw invalid(`${field} must be at most ${max} characters.`, { field });
  if (rules.pattern && !rules.pattern.test(v)) {
    throw invalid(`${field} is not in the expected format${rules.patternHint ? ` (${rules.patternHint})` : ''}.`, { field });
  }
  return v;
}

export function optStr(value: unknown, field: string, rules: StringRules = {}): string | null {
  if (value === undefined || value === null || value === '') return null;
  return str(value, field, rules);
}

export function num(value: unknown, field: string, opts: { min?: number; max?: number; positive?: boolean } = {}): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw invalid(`${field} must be a number.`, { field });
  if (opts.positive && value <= 0) throw invalid(`${field} must be greater than zero.`, { field });
  if (opts.min !== undefined && value < opts.min) throw invalid(`${field} must be at least ${opts.min}.`, { field });
  if (opts.max !== undefined && value > opts.max) throw invalid(`${field} must be at most ${opts.max}.`, { field });
  return value;
}

export function oneOf<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw invalid(`${field} must be one of: ${allowed.join(', ')}.`, { field });
  }
  return value as T;
}

export const sha256 = (value: unknown, field: string): string =>
  str(value, field, { pattern: SHA256_RE, patternHint: '64 lowercase hex characters', max: 64 });

export const userId = (value: unknown, field: string): string =>
  str(value, field, { pattern: USER_ID_RE, patternHint: '3–64 letters, digits, . _ -', max: 64 });

export const parcelId = (value: unknown): string =>
  str(value, 'parcelId', { pattern: PARCEL_ID_RE, patternHint: 'e.g. DSM-KIN-12-45', max: 40 });

export const entityId = (value: unknown, field: string): string =>
  str(value, field, { pattern: ENTITY_ID_RE, patternHint: 'e.g. TRF-0A1B2C3D4E5F6789', max: 20 });

export const reason = (value: unknown, field = 'reason'): string => str(value, field, { min: 3, max: 500 });

export function pageSize(raw: string): number {
  const n = Number(raw || '25');
  if (!Number.isInteger(n) || n < 1 || n > 100) throw invalid('pageSize must be an integer between 1 and 100.');
  return n;
}
