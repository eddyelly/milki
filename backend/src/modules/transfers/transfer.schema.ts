import { z } from 'zod';
import { nidaSchema, phoneSchema } from '../auth/auth.schema';
import { PARCEL_ID_RE } from '../parcels/parcel.schema';
import { TRANSFER_STATUSES } from './transfer.types';

export const TRANSFER_ID_RE = /^TRF-[A-F0-9]{16}$/;

export const transferParams = z.object({
  transferId: z
    .string()
    .transform((s) => s.toUpperCase())
    .pipe(z.string().regex(TRANSFER_ID_RE, 'Transfer IDs look like TRF-0A1B2C3D4E5F6789.')),
});

/** Who is buying: an active Milki landowner, by user ID, phone or NIDA. */
const buyerRef = z.union([
  z.object({ userId: z.string().regex(/^usr_[a-f0-9]{24}$/) }),
  z.object({ phone: phoneSchema }),
  z.object({ nida: nidaSchema }),
]);

export const initiateBody = z.object({
  parcelId: z
    .string()
    .transform((s) => s.trim().toUpperCase())
    .pipe(z.string().regex(PARCEL_ID_RE, 'Parcel IDs look like DSM-KIN-12-45.')),
  buyer: buyerRef,
  /** Private: goes only to the transferPrivate collection (Org1 + Org2). */
  salePrice: z.number().positive().max(1e15),
  currency: z.string().regex(/^[A-Z]{3}$/).default('TZS'),
});

export const noteBody = z.object({ note: z.string().trim().max(500).optional() });
export const reasonBody = z.object({ reason: z.string().trim().min(3, 'Give a reason (at least 3 characters).').max(500) });

/** Payment evidence: a receipt already uploaded to this transfer (POST /documents), referenced by document ID. */
export const confirmPaymentsBody = z.object({
  paymentReference: z.string().trim().min(3).max(80),
  evidenceDocumentId: z.string().regex(/^DOC-[A-F0-9]{16}$/, 'Upload the receipt first, then pass its document ID.'),
});

const SORTS = ['updatedAt', '-updatedAt', 'createdAt', '-createdAt'] as const;
export const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(40).optional(),
  status: z
    .string()
    .transform((s) => s.split(',').filter(Boolean))
    .pipe(z.array(z.enum(TRANSFER_STATUSES)))
    .optional(),
  parcelId: z.string().max(40).optional(),
  /** Citizens: transfers where I am the seller, the buyer, or either. */
  role: z.enum(['seller', 'buyer', 'any']).default('any'),
  sort: z.enum(SORTS).default('-updatedAt'),
});

export type InitiateBody = z.infer<typeof initiateBody>;
export type ConfirmPaymentsBody = z.infer<typeof confirmPaymentsBody>;
export type TransferListQuery = z.infer<typeof listQuery>;
