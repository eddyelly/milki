import { type Request, type Response, Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { ledger } from '../../core/fabric/ledger';
import { input, ok, validate } from '../../core/http';
import { parcelParams } from '../parcels/parcel.schema';
import type { LedgerParcel } from '../parcels/parcel.types';
import { User } from '../users/user.model';
import { displayName } from '../users/user.service';

/**
 * Public verification for QR codes on certificates and in the app (CLAUDE.md rule 3): no sign-in, answered
 * straight from the ledger with the read-only service identity, and limited to what a buyer or bank needs.
 */
export const verifyRouter = Router();
verifyRouter.use(
  rateLimit({
    windowMs: 60_000,
    limit: 60,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: { code: 'RATE_LIMITED', message: 'Too many verification requests. Please wait a minute.', details: null } },
  }),
);

verifyRouter.get('/parcels/:parcelId', validate({ params: parcelParams }), async (req: Request, res: Response) => {
  const { parcelId } = input<{ parcelId: string }>(req, 'params');
  const p = await ledger.evaluate<LedgerParcel>('service', 'GetParcel', [parcelId]);
  const owner = await User.findOne({ userId: p.ownerId }, { fullName: 1 }).lean();
  return ok(
    res,
    {
      parcelId: p.parcelId,
      titleNumber: p.titleNumber,
      region: p.region,
      district: p.district,
      ward: p.ward,
      area: p.area,
      landUse: p.landUse,
      status: p.status,
      owner: owner ? displayName(owner.fullName) : 'Registered owner',
      ownershipVersion: p.ownershipVersion,
      encumbered: p.activeEncumbranceIds.length > 0,
      disputed: p.openDisputeIds.length > 0,
      frozen: p.frozen,
      transferInProgress: p.activeTransferId !== null,
      lastTxId: p.lastTxId,
      updatedAt: p.updatedAt,
      verifiedAt: new Date().toISOString(),
    },
    { source: 'ledger' },
  );
});

const docParams = z.object({
  documentId: z
    .string()
    .transform((s) => s.toUpperCase())
    .pipe(z.string().regex(/^DOC-[A-F0-9]{16}$/, 'Document IDs look like DOC-0A1B2C3D4E5F6789.')),
});
const docQuery = z.object({ sha256: z.string().regex(/^[a-f0-9]{64}$/, 'sha256 must be 64 lowercase hex characters.') });

/** Hash check for a document (the QR on a certificate carries its ID and SHA-256). */
verifyRouter.get('/documents/:documentId', validate({ params: docParams, query: docQuery }), async (req: Request, res: Response) => {
  const { documentId } = input<{ documentId: string }>(req, 'params');
  const { sha256 } = input<{ sha256: string }>(req, 'query');
  const r = await ledger.evaluate<Record<string, unknown>>('service', 'VerifyDocument', [documentId, sha256]);
  return ok(res, { ...r, sha256, verifiedAt: new Date().toISOString() }, { source: 'ledger' });
});
