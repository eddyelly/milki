import type { ActorRef } from '../parcels/parcel.types';

/** Mirrors chaincode/src/models.ts. */
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
export const OPEN_TRANSFER_STATUSES: readonly TransferStatus[] = ['INITIATED', 'BUYER_ACCEPTED', 'PAYMENTS_CONFIRMED', 'OFFICER_VERIFIED'];

export interface LedgerTransfer {
  docType: 'transfer';
  transferId: string;
  parcelId: string;
  sellerId: string;
  buyerId: string;
  buyerNidaHash: string;
  ownershipVersion: number;
  status: TransferStatus;
  paymentReference: string | null;
  paymentEvidenceHash: string | null;
  verifiedBy: ActorRef | null;
  approvedBy: ActorRef | null;
  closedReason: string | null;
  documentIds: string[];
  history: { status: TransferStatus; at: string; by: ActorRef; txId: string; note: string | null }[];
  createdAt: string;
  createdBy: ActorRef;
  updatedAt: string;
  updatedBy: ActorRef;
  lastTxId: string;
}

export interface TransferPrivateDetails {
  transferId: string;
  salePrice: number;
  currency: string;
  sellerNidaRef: string;
  buyerNidaRef: string;
  sellerContactHash: string;
  buyerContactHash: string;
}
