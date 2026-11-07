import { model, Schema } from 'mongoose';
import { seal, type Sealed, unseal } from '../crypto';
import { logger } from '../logger';
import { ROLE_ORG, type OrgKey, type Role } from '../roles';
import { type EnrolledIdentity, type IdentityAttributes, registerAndEnroll } from './ca';

/**
 * Custodial wallet (CLAUDE.md §12): X.509 certificate in clear, private key sealed with AES-256-GCM.
 * The AAD binds each ciphertext to its owner, so a sealed key copied onto another user's record fails to open.
 */
const walletSchema = new Schema(
  {
    label: { type: String, required: true, unique: true },
    org: { type: String, enum: ['org1', 'org2', 'org3'], required: true },
    mspId: { type: String, required: true },
    certificate: { type: String, required: true },
    privateKey: { type: new Schema({ iv: String, tag: String, ct: String }, { _id: false }), required: true },
    attrs: { role: String, bank: String },
  },
  { timestamps: true, collection: 'wallet' },
);

const WalletEntry = model('WalletEntry', walletSchema);

export interface LedgerIdentity extends EnrolledIdentity {
  org: OrgKey;
  label: string;
}

const aad = (label: string) => `milki-wallet:${label}`;

async function store(label: string, org: OrgKey, enrolled: EnrolledIdentity, attrs: IdentityAttributes): Promise<LedgerIdentity> {
  await WalletEntry.findOneAndUpdate(
    { label },
    {
      label,
      org,
      mspId: enrolled.mspId,
      certificate: enrolled.certificate,
      privateKey: seal(enrolled.privateKeyPem, aad(label)),
      attrs,
    },
    { upsert: true },
  );
  return { ...enrolled, org, label };
}

async function load(label: string): Promise<LedgerIdentity | null> {
  const doc = await WalletEntry.findOne({ label }).lean();
  if (!doc) return null;
  return {
    label,
    org: doc.org as OrgKey,
    mspId: doc.mspId,
    certificate: doc.certificate,
    privateKeyPem: unseal(doc.privateKey as Sealed, aad(label)),
  };
}

const inflight = new Map<string, Promise<LedgerIdentity>>();

/** Loads an identity, enrolling it with the CA first if the wallet has none. Concurrent calls share one enrollment. */
async function getOrEnroll(label: string, org: OrgKey, attrs: IdentityAttributes): Promise<LedgerIdentity> {
  const existing = await load(label);
  if (existing) return existing;
  let p = inflight.get(label);
  if (!p) {
    p = registerAndEnroll(org, label, attrs)
      .then((enrolled) => store(label, org, enrolled, attrs))
      .finally(() => inflight.delete(label));
    inflight.set(label, p);
  }
  return p;
}

export interface WalletUser {
  userId: string;
  role: Role;
  bankCode?: string | null | undefined;
}

/** The identity a user submits with (org chosen from the role, CLAUDE.md §12). */
export function userIdentity(user: WalletUser): Promise<LedgerIdentity> {
  const attrs: IdentityAttributes = { role: user.role, ...(user.role === 'BANK_OFFICER' && user.bankCode ? { bank: user.bankCode } : {}) };
  return getOrEnroll(user.userId, ROLE_ORG[user.role], attrs);
}

/** Read-only backend identity per org (no role attribute → chaincode allows reads only). */
export function serviceIdentity(org: OrgKey = 'org1'): Promise<LedgerIdentity> {
  return getOrEnroll(`svc_milki_api_${org}`, org, {});
}

/** Drops a user's wallet entry, e.g. after a role change; the next ledger call re-enrolls with new attributes. */
export async function forgetIdentity(label: string): Promise<void> {
  await WalletEntry.deleteOne({ label });
  logger.info({ label }, 'wallet entry removed');
}
