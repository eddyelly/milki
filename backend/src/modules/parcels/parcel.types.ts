/** Mirrors chaincode/src/models.ts (the on-chain shapes the backend reads). */
export interface ActorRef {
  id: string;
  mspId: string;
  role: string | null;
}

export type ParcelStatus = 'ACTIVE' | 'PENDING_TRANSFER' | 'ENCUMBERED' | 'DISPUTED' | 'FROZEN' | 'RETIRED';
export const LAND_USES = ['RESIDENTIAL', 'COMMERCIAL', 'AGRICULTURAL', 'INDUSTRIAL', 'INSTITUTIONAL', 'MIXED_USE'] as const;
export const PARCEL_STATUSES = ['ACTIVE', 'PENDING_TRANSFER', 'ENCUMBERED', 'DISPUTED', 'FROZEN', 'RETIRED'] as const;

export interface LedgerParcel {
  docType: 'parcel';
  parcelId: string;
  titleNumber: string;
  region: string;
  district: string;
  ward: string;
  blockNumber: string;
  plotNumber: string;
  area: number;
  landUse: string;
  location: { latitude: number; longitude: number; boundary: [number, number][] | null; address: string | null };
  ownerId: string;
  ownerNidaHash: string;
  ownershipVersion: number;
  status: ParcelStatus;
  frozen: boolean;
  frozenReason: string | null;
  retired: boolean;
  retiredReason: string | null;
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

export interface LedgerHistoryEntry {
  txId: string;
  timestamp: string;
  isDelete: boolean;
  parcel: LedgerParcel | null;
}
