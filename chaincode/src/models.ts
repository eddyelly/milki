/**
 * On-chain data model. Rule 4: no personal data here, people are referenced by opaque Milki user IDs
 * (their Fabric CA enrollment ID) and salted hashes computed off-chain. Rule 5: documents are SHA-256 only.
 */

// ---------------------------------------------------------------------------
// Roles and actors
// ---------------------------------------------------------------------------
export const ROLES = ['CITIZEN', 'LAND_OFFICER', 'REGISTRAR', 'BANK_OFFICER', 'SUPPORT_AGENT', 'SYSTEM_ADMIN'] as const;
export type Role = (typeof ROLES)[number];

/** Which MSP may issue each role (CLAUDE.md §2). A role presented from any other org is rejected. */
export const ROLE_MSP: Readonly<Record<Role, string>> = {
  CITIZEN: 'Org1MSP',
  REGISTRAR: 'Org1MSP',
  SUPPORT_AGENT: 'Org1MSP',
  SYSTEM_ADMIN: 'Org1MSP',
  LAND_OFFICER: 'Org2MSP',
  BANK_OFFICER: 'Org3MSP',
};

/** Who did something. `id` is the CA enrollment ID (= Milki user ID for people). */
export interface ActorRef {
  id: string;
  mspId: string;
  role: Role | null;
}

// ---------------------------------------------------------------------------
// Parcel
// ---------------------------------------------------------------------------
export const PARCEL_STATUSES = ['ACTIVE', 'PENDING_TRANSFER', 'ENCUMBERED', 'DISPUTED', 'FROZEN', 'RETIRED'] as const;
export type ParcelStatus = (typeof PARCEL_STATUSES)[number];

export const LAND_USES = ['RESIDENTIAL', 'COMMERCIAL', 'AGRICULTURAL', 'INDUSTRIAL', 'INSTITUTIONAL', 'MIXED_USE'] as const;
export type LandUse = (typeof LAND_USES)[number];

export interface ParcelLocation {
  latitude: number;
  longitude: number;
  /** Optional survey boundary as [longitude, latitude] pairs (GeoJSON order). */
  boundary: [number, number][] | null;
  /** Street / area description. Must not contain personal data. */
  address: string | null;
}

export interface Parcel {
  docType: 'parcel';
  parcelId: string;
  titleNumber: string;
  region: string;
  district: string;
  ward: string;
  blockNumber: string;
  plotNumber: string;
  /** Square metres. */
  area: number;
  landUse: LandUse;
  location: ParcelLocation;
  ownerId: string;
  ownerNidaHash: string;
  /** Incremented on every change of owner; lets a transfer detect a stale seller. */
  ownershipVersion: number;
  /** Derived from the flags below on every write, never set directly. */
  status: ParcelStatus;
  frozen: boolean;
  frozenReason: string | null;
  retired: boolean;
  retiredReason: string | null;
  /** Reason given for the latest registry action (freeze, area correction, …). */
  lastChangeNote: string | null;
  activeTransferId: string | null;
  transferIds: string[];
  activeEncumbranceIds: string[];
  encumbranceIds: string[];
  openDisputeIds: string[];
  disputeIds: string[];
  documentIds: string[];
  createdAt: string;
  createdBy: ActorRef;
  updatedAt: string;
  updatedBy: ActorRef;
  lastTxId: string;
}

// ---------------------------------------------------------------------------
// Transfer
// ---------------------------------------------------------------------------
export const TRANSFER_STATUSES = [
  'INITIATED',
  'BUYER_ACCEPTED',
  'PAYMENTS_CONFIRMED',
  'OFFICER_VERIFIED',
  'APPROVED',
  'COMPLETED',
  'CANCELLED',
  'REJECTED',
] as const;
export type TransferStatus = (typeof TRANSFER_STATUSES)[number];
export const TERMINAL_TRANSFER_STATUSES: readonly TransferStatus[] = ['COMPLETED', 'CANCELLED', 'REJECTED'];

export interface TransferStep {
  status: TransferStatus;
  at: string;
  by: ActorRef;
  txId: string;
  note: string | null;
}

export interface Transfer {
  docType: 'transfer';
  transferId: string;
  parcelId: string;
  sellerId: string;
  buyerId: string;
  buyerNidaHash: string;
  /** Parcel ownershipVersion when the transfer started. */
  ownershipVersion: number;
  status: TransferStatus;
  paymentReference: string | null;
  paymentEvidenceHash: string | null;
  verifiedBy: ActorRef | null;
  approvedBy: ActorRef | null;
  closedReason: string | null;
  documentIds: string[];
  history: TransferStep[];
  createdAt: string;
  createdBy: ActorRef;
  updatedAt: string;
  updatedBy: ActorRef;
  lastTxId: string;
}

/** Stored in the `transferPrivate` collection (Org1 + Org2 only). */
export interface TransferPrivateDetails {
  transferId: string;
  salePrice: number;
  currency: string;
  sellerNidaRef: string;
  buyerNidaRef: string;
  sellerContactHash: string;
  buyerContactHash: string;
}

// ---------------------------------------------------------------------------
// Encumbrance
// ---------------------------------------------------------------------------
export const ENCUMBRANCE_TYPES = ['MORTGAGE', 'CHARGE', 'CAVEAT', 'LIEN'] as const;
export type EncumbranceType = (typeof ENCUMBRANCE_TYPES)[number];
export type EncumbranceStatus = 'ACTIVE' | 'RELEASED';

export interface EncumbranceChange {
  at: string;
  by: ActorRef;
  txId: string;
  changes: { field: string; from: string | number | null; to: string | number | null }[];
}

export interface Encumbrance {
  docType: 'encumbrance';
  encumbranceId: string;
  parcelId: string;
  type: EncumbranceType;
  /** Bank code from the officer's CA certificate attribute `bank` (e.g. CRDB). Only that bank may change it. */
  lenderCode: string;
  /** Display name, e.g. "CRDB Bank". */
  lenderName: string;
  amount: number;
  currency: string;
  reference: string;
  termsHash: string | null;
  status: EncumbranceStatus;
  releaseReason: string | null;
  releasedAt: string | null;
  releasedBy: ActorRef | null;
  changes: EncumbranceChange[];
  createdAt: string;
  createdBy: ActorRef;
  updatedAt: string;
  updatedBy: ActorRef;
  lastTxId: string;
}

// ---------------------------------------------------------------------------
// Dispute
// ---------------------------------------------------------------------------
export const DISPUTE_CATEGORIES = ['OWNERSHIP', 'BOUNDARY', 'INHERITANCE', 'FRAUD', 'COURT_ORDER', 'OTHER'] as const;
export type DisputeCategory = (typeof DISPUTE_CATEGORIES)[number];
export type DisputeStatus = 'OPEN' | 'RESOLVED';

export interface DisputeNote {
  at: string;
  by: ActorRef;
  txId: string;
  text: string;
}

export interface Dispute {
  docType: 'dispute';
  disputeId: string;
  parcelId: string;
  category: DisputeCategory;
  summary: string;
  status: DisputeStatus;
  notes: DisputeNote[];
  resolution: string | null;
  resolvedAt: string | null;
  resolvedBy: ActorRef | null;
  createdAt: string;
  createdBy: ActorRef;
  updatedAt: string;
  updatedBy: ActorRef;
  lastTxId: string;
}

// ---------------------------------------------------------------------------
// Document reference
// ---------------------------------------------------------------------------
export const DOCUMENT_TYPES = [
  'TITLE_DEED',
  'SALE_AGREEMENT',
  'SURVEY_PLAN',
  'ID_COPY',
  'TAX_RECEIPT',
  'PAYMENT_PROOF',
  'VALUATION_REPORT',
  'MORTGAGE_DEED',
  'COURT_ORDER',
  'OTHER',
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];
export type DocumentTargetType = 'PARCEL' | 'TRANSFER';
export type DocumentStatus = 'ACTIVE' | 'SUPERSEDED';

export interface DocumentRef {
  docType: 'document';
  documentId: string;
  targetType: DocumentTargetType;
  targetId: string;
  parcelId: string;
  documentType: DocumentType;
  sha256: string;
  version: number;
  /** First version's ID, groups every version of the same document. */
  rootDocumentId: string;
  supersedes: string | null;
  supersededBy: string | null;
  status: DocumentStatus;
  createdAt: string;
  createdBy: ActorRef;
  updatedAt: string;
  updatedBy: ActorRef;
  lastTxId: string;
}
