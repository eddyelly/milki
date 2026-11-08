import { model, Schema } from 'mongoose';
import type { WalletUser } from '../../core/fabric/wallet';
import { ledger } from '../../core/fabric/ledger';

/** Ledger shape (chaincode/src/models.ts → Encumbrance). */
export interface LedgerEncumbrance {
  encumbranceId: string;
  parcelId: string;
  type: 'MORTGAGE' | 'CHARGE' | 'CAVEAT' | 'LIEN';
  lenderCode: string;
  lenderName: string;
  amount: number;
  currency: string;
  reference: string;
  termsHash: string | null;
  status: 'ACTIVE' | 'RELEASED';
  releaseReason: string | null;
  releasedAt: string | null;
  createdAt: string;
  updatedAt: string;
  lastTxId: string;
}

/** Read cache for bank work lists (CLAUDE.md rule 3: verification reads still go to the ledger). */
const encumbranceCacheSchema = new Schema(
  {
    encumbranceId: { type: String, required: true, unique: true },
    parcelId: { type: String, required: true, index: true },
    type: String,
    lenderCode: { type: String, index: true },
    lenderName: String,
    amount: Number,
    currency: String,
    reference: String,
    status: { type: String, index: true },
    releaseReason: String,
    releasedAt: Date,
    ledgerCreatedAt: Date,
    ledgerUpdatedAt: { type: Date, index: true },
    lastTxId: String,
    lastBlock: Number,
  },
  { timestamps: true, collection: 'encumbrance_cache', versionKey: false },
);
export const EncumbranceCache = model('EncumbranceCache', encumbranceCacheSchema);

export async function syncEncumbrance(encumbranceId: string, blockNumber: number): Promise<void> {
  const e = await ledger.evaluate<LedgerEncumbrance>('service', 'GetEncumbrance', [encumbranceId]);
  await EncumbranceCache.updateOne(
    { encumbranceId },
    {
      encumbranceId: e.encumbranceId,
      parcelId: e.parcelId,
      type: e.type,
      lenderCode: e.lenderCode,
      lenderName: e.lenderName,
      amount: e.amount,
      currency: e.currency,
      reference: e.reference,
      status: e.status,
      releaseReason: e.releaseReason,
      releasedAt: e.releasedAt ? new Date(e.releasedAt) : null,
      ledgerCreatedAt: new Date(e.createdAt),
      ledgerUpdatedAt: new Date(e.updatedAt),
      lastTxId: e.lastTxId,
      lastBlock: blockNumber,
    },
    { upsert: true },
  );
}

export interface AddInput {
  type: LedgerEncumbrance['type'];
  amount: number;
  currency: string;
  reference: string;
  termsHash?: string | null;
}

/** Shared by the portal (bank officers) and the partner API (bank service identities). */
export async function addEncumbrance(who: WalletUser, lenderName: string, parcelId: string, input: AddInput) {
  const payload = { type: input.type, lenderName, amount: input.amount, currency: input.currency, reference: input.reference, ...(input.termsHash ? { termsHash: input.termsHash } : {}) };
  return ledger.submit<LedgerEncumbrance>(who, 'AddEncumbrance', [parcelId, JSON.stringify(payload)], { entityType: 'Encumbrance', entityId: parcelId });
}

export async function updateEncumbrance(who: WalletUser, encumbranceId: string, patch: { amount?: number; currency?: string; reference?: string; termsHash?: string | null }) {
  return ledger.submit<LedgerEncumbrance>(who, 'UpdateEncumbrance', [encumbranceId, JSON.stringify(patch)], { entityType: 'Encumbrance', entityId: encumbranceId });
}

export async function releaseEncumbrance(who: WalletUser, encumbranceId: string, reason: string) {
  return ledger.submit<LedgerEncumbrance>(who, 'ReleaseEncumbrance', [encumbranceId, reason], { entityType: 'Encumbrance', entityId: encumbranceId });
}
