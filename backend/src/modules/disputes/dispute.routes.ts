import { type Request, type Response, Router } from 'express';
import { z } from 'zod';
import { currentUser, requireAuth, requireReauth, requireRole } from '../../core/auth';
import { ledger } from '../../core/fabric/ledger';
import { input, submitted, validate } from '../../core/http';
import { idempotent } from '../../core/idempotency';
import type { Role } from '../../core/roles';
import { audit } from '../audit/audit.model';
import { parcelParams } from '../parcels/parcel.schema';
import { toWalletUser } from '../users/user.service';

/** Disputes (CLAUDE.md §7.1): flagged by land officers; notes and resolution by officers or registrars. All T3. */
export const disputeRouter = Router();
disputeRouter.use(requireAuth);

const t3 = (...roles: Role[]) => [requireRole(...roles), idempotent, requireReauth] as const;
const disputeParams = z.object({
  disputeId: z
    .string()
    .transform((s) => s.toUpperCase())
    .pipe(z.string().regex(/^DSP-[A-F0-9]{16}$/, 'Dispute IDs look like DSP-0A1B2C3D4E5F6789.')),
});

export const flagBody = z.object({
  category: z.enum(['OWNERSHIP', 'BOUNDARY', 'INHERITANCE', 'FRAUD', 'COURT_ORDER', 'OTHER']),
  /** Shown to officials and stored on-chain, describe the issue, never personal data. */
  summary: z.string().trim().min(10, 'Describe the dispute in at least 10 characters.').max(500),
});

interface LedgerDispute {
  disputeId: string;
  parcelId: string;
  status: string;
}

/** Mounted under /parcels: POST /parcels/:parcelId/disputes */
export const parcelDisputeRouter = Router({ mergeParams: true });
parcelDisputeRouter.post('/:parcelId/disputes', requireAuth, ...t3('LAND_OFFICER'), validate({ params: parcelParams, body: flagBody }), async (req: Request, res: Response) => {
  const { parcelId } = input<{ parcelId: string }>(req, 'params');
  const body = input<z.infer<typeof flagBody>>(req, 'body');
  const r = await ledger.submit<LedgerDispute>(await toWalletUser(currentUser(req)), 'FlagDispute', [parcelId, JSON.stringify(body)], {
    entityType: 'Dispute',
    entityId: parcelId,
  });
  await audit(req, { action: 'dispute.flag', entityType: 'Dispute', entityId: r.result.disputeId, txId: r.txId, meta: { parcelId, category: body.category } });
  return submitted(res, { txId: r.txId, disputeId: r.result.disputeId, parcelId });
});

const noteBody = z.object({ note: z.string().trim().min(3).max(1000) });
const resolveBody = z.object({ resolution: z.string().trim().min(3).max(1000) });

disputeRouter.post('/:disputeId/notes', ...t3('LAND_OFFICER', 'REGISTRAR'), validate({ params: disputeParams, body: noteBody }), async (req: Request, res: Response) => {
  const { disputeId } = input<{ disputeId: string }>(req, 'params');
  const { note } = input<{ note: string }>(req, 'body');
  const r = await ledger.submit<LedgerDispute>(await toWalletUser(currentUser(req)), 'AddDisputeNote', [disputeId, note], { entityType: 'Dispute', entityId: disputeId });
  await audit(req, { action: 'dispute.note', entityType: 'Dispute', entityId: disputeId, txId: r.txId });
  return submitted(res, { txId: r.txId, disputeId, parcelId: r.result.parcelId });
});

disputeRouter.post('/:disputeId/resolve', ...t3('LAND_OFFICER', 'REGISTRAR'), validate({ params: disputeParams, body: resolveBody }), async (req: Request, res: Response) => {
  const { disputeId } = input<{ disputeId: string }>(req, 'params');
  const { resolution } = input<{ resolution: string }>(req, 'body');
  const r = await ledger.submit<LedgerDispute>(await toWalletUser(currentUser(req)), 'ResolveDispute', [disputeId, resolution], { entityType: 'Dispute', entityId: disputeId });
  await audit(req, { action: 'dispute.resolve', entityType: 'Dispute', entityId: disputeId, txId: r.txId, meta: { parcelId: r.result.parcelId } });
  return submitted(res, { txId: r.txId, disputeId, parcelId: r.result.parcelId });
});
