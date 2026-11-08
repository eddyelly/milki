import { model, Schema } from 'mongoose';
import { randomBytes } from 'node:crypto';
import { randomToken, safeEqual, sha256Hex } from '../../core/crypto';

export const PARTNER_SCOPES = ['parcels:verify', 'encumbrances:write'] as const;
export type PartnerScope = (typeof PARTNER_SCOPES)[number];

/** Bank API clients (CLAUDE.md §7.2, §12). The key is shown once; only its SHA-256 is stored. */
const apiClientSchema = new Schema(
  {
    clientId: { type: String, required: true, unique: true },
    name: { type: String, required: true, trim: true },
    bankCode: { type: String, required: true, uppercase: true, trim: true },
    bankName: { type: String, required: true, trim: true },
    scopes: { type: [String], enum: PARTNER_SCOPES, default: ['parcels:verify'] },
    /** First characters of the key, for lookup and for staff to recognise it ("mlk_1a2b3c4d…"). */
    keyPrefix: { type: String, required: true, unique: true },
    keyHash: { type: String, required: true },
    rateLimitPerMin: { type: Number, default: 60, min: 1, max: 6000 },
    status: { type: String, enum: ['ACTIVE', 'REVOKED'], default: 'ACTIVE', index: true },
    lastUsedAt: { type: Date, default: null },
    rotatedAt: { type: Date, default: null },
    createdBy: { type: String, required: true },
    revokedAt: { type: Date, default: null },
    revokedBy: { type: String, default: null },
  },
  { timestamps: true, collection: 'api_clients', versionKey: false },
);
export const ApiClient = model('ApiClient', apiClientSchema);

/** `mlk_<8 hex prefix>_<43 base64url secret>` */
export function newApiKey(): { key: string; prefix: string; hash: string } {
  const prefix = randomBytes(4).toString('hex');
  const key = `mlk_${prefix}_${randomToken(32)}`;
  return { key, prefix, hash: sha256Hex(key) };
}

export function parseApiKey(raw: string): { prefix: string } | null {
  const m = /^mlk_([a-f0-9]{8})_[A-Za-z0-9_-]{40,60}$/.exec(raw.trim());
  return m ? { prefix: m[1]! } : null;
}

export const keyMatches = (raw: string, hash: string) => safeEqual(sha256Hex(raw.trim()), hash);

export function publicClient(c: InstanceType<typeof ApiClient> | Record<string, unknown>) {
  const o = ('toObject' in c && typeof c.toObject === 'function' ? c.toObject() : c) as Record<string, unknown>;
  const { keyHash: _hash, ...rest } = o;
  return { ...rest, keyHint: `mlk_${o.keyPrefix as string}_…` };
}
