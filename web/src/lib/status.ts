import {
  Archive,
  BadgeCheck,
  Ban,
  CircleCheck,
  Handshake,
  Landmark,
  type LucideIcon,
  Receipt,
  Repeat2,
  Send,
  ShieldCheck,
  Snowflake,
  Stamp,
  TriangleAlert,
  CircleX,
} from 'lucide-react';
import type { ParcelStatus, TransferStatus } from './types';

export interface StatusMeta {
  label: string;
  /** Swahili label (portal is English-first; kept for parity with mobile). */
  labelSw: string;
  icon: LucideIcon;
  /** CSS variable holding the status colour (CLAUDE.md §9.1). */
  color: string;
  /** Readable text colour on a tinted background (gold needs a darker ink for AA). */
  ink?: string;
  description: string;
}

export const PARCEL_STATUS: Record<ParcelStatus, StatusMeta> = {
  ACTIVE: { label: 'Active', labelSw: 'Hai', icon: ShieldCheck, color: 'var(--status-active)', description: 'Registered and free to transact.' },
  PENDING_TRANSFER: {
    label: 'Pending transfer',
    labelSw: 'Uhamisho unaendelea',
    icon: Repeat2,
    color: 'var(--status-pending)',
    ink: 'var(--status-pending-ink)',
    description: 'A transfer of this parcel is in progress.',
  },
  ENCUMBERED: { label: 'Encumbered', labelSw: 'Ina rehani', icon: Landmark, color: 'var(--status-encumbered)', description: 'A bank holds a mortgage or charge on it.' },
  DISPUTED: { label: 'Disputed', labelSw: 'Mgogoro', icon: TriangleAlert, color: 'var(--status-disputed)', description: 'An open dispute blocks transfers.' },
  FROZEN: { label: 'Frozen', labelSw: 'Imezuiliwa', icon: Snowflake, color: 'var(--status-frozen)', description: 'Frozen by the registry; no changes allowed.' },
  RETIRED: { label: 'Retired', labelSw: 'Imestaafishwa', icon: Archive, color: 'var(--status-frozen)', description: 'Retired from the register (kept for history).' },
};

export const TRANSFER_STATUS: Record<TransferStatus, StatusMeta> = {
  INITIATED: { label: 'Initiated', labelSw: 'Imeanzishwa', icon: Send, color: 'var(--status-pending)', ink: 'var(--status-pending-ink)', description: 'Waiting for the buyer to accept.' },
  BUYER_ACCEPTED: { label: 'Buyer accepted', labelSw: 'Mnunuzi amekubali', icon: Handshake, color: 'var(--status-pending)', ink: 'var(--status-pending-ink)', description: 'Waiting for payment confirmation.' },
  PAYMENTS_CONFIRMED: { label: 'Payments confirmed', labelSw: 'Malipo yamethibitishwa', icon: Receipt, color: 'var(--status-encumbered)', description: 'Waiting for officer verification.' },
  OFFICER_VERIFIED: { label: 'Officer verified', labelSw: 'Imehakikiwa', icon: BadgeCheck, color: 'var(--status-active)', description: 'Waiting for registrar approval.' },
  APPROVED: { label: 'Approved', labelSw: 'Imeidhinishwa', icon: Stamp, color: 'var(--status-active)', description: 'Approved by the registrar.' },
  COMPLETED: { label: 'Completed', labelSw: 'Imekamilika', icon: CircleCheck, color: 'var(--status-completed)', description: 'Ownership has moved to the buyer.' },
  CANCELLED: { label: 'Cancelled', labelSw: 'Imesitishwa', icon: CircleX, color: 'var(--status-rejected)', description: 'Cancelled by the seller.' },
  REJECTED: { label: 'Rejected', labelSw: 'Imekataliwa', icon: Ban, color: 'var(--status-rejected)', description: 'Rejected by the land registry.' },
};

/** The happy path shown by the transfer tracker (APPROVED and COMPLETED are recorded together). */
export const TRANSFER_STEPS: { status: TransferStatus; label: string; actor: string }[] = [
  { status: 'INITIATED', label: 'Initiated', actor: 'Seller' },
  { status: 'BUYER_ACCEPTED', label: 'Buyer accepted', actor: 'Buyer' },
  { status: 'PAYMENTS_CONFIRMED', label: 'Payments confirmed', actor: 'Land officer' },
  { status: 'OFFICER_VERIFIED', label: 'Verified', actor: 'Land officer' },
  { status: 'COMPLETED', label: 'Approved & recorded', actor: 'Registrar' },
];
