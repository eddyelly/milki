/** Shapes returned by the Milki API (see docs/openapi.yaml). */

export type Role = 'CITIZEN' | 'LAND_OFFICER' | 'REGISTRAR' | 'BANK_OFFICER' | 'SUPPORT_AGENT' | 'SYSTEM_ADMIN';

export interface User {
  userId: string;
  role: Role;
  fullName: string;
  email: string | null;
  phone: string;
  nidaMasked: string | null;
  status: 'PENDING_VERIFICATION' | 'ACTIVE' | 'DEACTIVATED';
  bankCode: string | null;
  bankName: string | null;
  preferredLanguage: 'en' | 'sw';
  ledgerIdentity: { enrolled: boolean; mspId: string | null };
}

export interface Envelope<T> {
  data: T;
  meta: Record<string, unknown> | null;
}

export interface PageMeta {
  page: number;
  limit: number;
  total: number;
  pages: number;
  source?: 'cache' | 'ledger';
}

export interface OtpChallenge {
  challengeId: string;
  sentTo: string;
  expiresIn: number;
  purpose?: 'REGISTER' | 'LOGIN';
}

export interface Session {
  user: User;
  accessToken: string;
  refreshToken: string;
  accessExpiresIn: string;
}

export interface ActorRef {
  id: string;
  mspId: string;
  role: string | null;
}

export const PARCEL_STATUSES = ['ACTIVE', 'PENDING_TRANSFER', 'ENCUMBERED', 'DISPUTED', 'FROZEN', 'RETIRED'] as const;
export type ParcelStatus = (typeof PARCEL_STATUSES)[number];

export const LAND_USES = ['RESIDENTIAL', 'COMMERCIAL', 'AGRICULTURAL', 'INDUSTRIAL', 'INSTITUTIONAL', 'MIXED_USE'] as const;
export type LandUse = (typeof LAND_USES)[number];

/** Row from the parcel cache (lists). */
export interface ParcelSummary {
  parcelId: string;
  titleNumber: string;
  region: string;
  district: string;
  ward: string;
  area: number;
  landUse: LandUse;
  ownerId: string;
  status: ParcelStatus;
  ledgerUpdatedAt: string;
}

/** Parcel straight from the ledger. */
export interface Parcel {
  parcelId: string;
  titleNumber: string;
  region: string;
  district: string;
  ward: string;
  blockNumber: string;
  plotNumber: string;
  area: number;
  landUse: LandUse;
  location: { latitude: number; longitude: number; boundary: [number, number][] | null; address: string | null };
  owner: { userId: string; fullName?: string; phone?: string };
  ownershipVersion: number;
  status: ParcelStatus;
  frozen: boolean;
  frozenReason: string | null;
  retired: boolean;
  retiredReason: string | null;
  lastChangeNote: string | null;
  activeTransferId: string | null;
  activeEncumbranceIds: string[];
  openDisputeIds: string[];
  createdAt: string;
  updatedAt: string;
  updatedBy: ActorRef;
  lastTxId: string;
}

export interface HistoryEntry {
  txId: string;
  timestamp: string;
  status: ParcelStatus | null;
  ownerId: string | null;
  ownerName?: string | null;
  ownershipVersion: number | null;
  changedBy: ActorRef | null;
  note: string | null;
}

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

export interface TransferSummary {
  transferId: string;
  parcelId: string;
  sellerId: string;
  buyerId: string;
  status: TransferStatus;
  ledgerCreatedAt: string;
  ledgerUpdatedAt: string;
}

export interface Party {
  userId: string;
  fullName?: string;
  phone?: string;
}

export interface Transfer {
  transferId: string;
  parcelId: string;
  sellerId: string;
  buyerId: string;
  seller: Party;
  buyer: Party;
  status: TransferStatus;
  ownershipVersion: number;
  paymentReference: string | null;
  paymentEvidenceHash: string | null;
  verifiedBy: ActorRef | null;
  approvedBy: ActorRef | null;
  closedReason: string | null;
  documentIds: string[];
  history: { status: TransferStatus; at: string; by: ActorRef; txId: string; note: string | null }[];
  sale: { salePrice: number; currency: string } | null;
  createdAt: string;
  updatedAt: string;
  lastTxId: string;
}

export interface DocumentRef {
  documentId: string;
  targetType: 'PARCEL' | 'TRANSFER';
  targetId: string;
  documentType: string;
  sha256: string;
  version: number;
  status: 'ACTIVE' | 'SUPERSEDED';
  supersededBy: string | null;
  createdAt: string;
  createdBy: ActorRef;
  file: { mimeType: string; size: number; name: string | null } | null;
}

export interface Encumbrance {
  encumbranceId: string;
  type: string;
  lenderName: string;
  lenderCode: string;
  amount: number;
  currency: string;
  reference: string;
  status: 'ACTIVE' | 'RELEASED';
  createdAt: string;
  releasedAt: string | null;
}

export interface Dispute {
  disputeId: string;
  category: string;
  summary: string;
  status: 'OPEN' | 'RESOLVED';
  notes: { at: string; by: ActorRef; text: string; txId: string }[];
  resolution: string | null;
  createdAt: string;
  createdBy: ActorRef;
  resolvedAt: string | null;
}

export interface Overview {
  parcels: { total: number; byStatus: Partial<Record<ParcelStatus, number>>; byRegion: { region: string; count: number }[] };
  transfers: { total: number; byStatus: Partial<Record<TransferStatus, number>>; monthly: { month: string; started: number; completed: number }[] };
  queues: { awaitingPayments: number; awaitingVerification: number; awaitingApproval: number };
  generatedAt: string;
}

export interface NotificationItem {
  _id: string;
  type: string;
  title: string;
  body: string;
  data: { parcelId?: string; transferId?: string; txId?: string };
  readAt: string | null;
  createdAt: string;
}

export interface Submitted {
  txId: string;
  status: 'SUBMITTED';
  [extra: string]: unknown;
}

export interface LedgerTxStatus {
  txId: string;
  status: 'SUBMITTED' | 'COMMITTED' | 'FAILED';
  blockNumber?: number;
  validationCode?: string;
}
