import { type Request, type Response, Router } from 'express';
import { currentUser, requireAuth, requireReauth, requireRole } from '../../core/auth';
import { input, ok, pageMeta, submitted, validate } from '../../core/http';
import { idempotent } from '../../core/idempotency';
import type { Role } from '../../core/roles';
import { audit } from '../audit/audit.model';
import { listForTarget } from '../documents/document.service';
import { confirmPaymentsBody, initiateBody, listQuery, noteBody, reasonBody, transferParams } from './transfer.schema';
import type { ConfirmPaymentsBody, InitiateBody, TransferListQuery } from './transfer.schema';
import * as svc from './transfer.service';

export const transferRouter = Router();
transferRouter.use(requireAuth);

const tid = (req: Request) => input<{ transferId: string }>(req, 'params').transferId;
/** Ledger write pipeline (CLAUDE.md §8/§12): role → idempotency → re-auth → validation. */
const t3 = (...roles: Role[]) => [requireRole(...roles), idempotent, requireReauth] as const;

// ------------------------------------------------------------------------------------------- reads
transferRouter.get('/', validate({ query: listQuery }), async (req: Request, res: Response) => {
  const q = input<TransferListQuery>(req, 'query');
  const { items, total } = await svc.list(currentUser(req), q);
  return ok(res, items, { ...pageMeta(q, total), source: 'cache' });
});

transferRouter.get('/:transferId', validate({ params: transferParams }), async (req: Request, res: Response) =>
  ok(res, await svc.get(currentUser(req), tid(req)), { source: 'ledger' }),
);

transferRouter.get('/:transferId/documents', validate({ params: transferParams }), async (req: Request, res: Response) => {
  await svc.get(currentUser(req), tid(req)); // same visibility rules as the transfer itself
  return ok(res, await listForTarget(currentUser(req), 'TRANSFER', tid(req)), { source: 'ledger' });
});

// ------------------------------------------------------------------------------------------ writes
transferRouter.post('/', ...t3('CITIZEN'), validate({ body: initiateBody }), async (req: Request, res: Response) => {
  const body = input<InitiateBody>(req, 'body');
  const r = await svc.initiate(currentUser(req), body);
  // The sale price is private: never in the audit log.
  await audit(req, { action: 'transfer.initiate', entityType: 'Transfer', entityId: r.transferId, txId: r.txId, meta: { parcelId: r.parcelId, buyerId: r.buyerId } });
  return submitted(res, { txId: r.txId, transferId: r.transferId, parcelId: r.parcelId });
});

const simple = (
  path: string,
  roles: Role[],
  fn: 'AcceptTransfer' | 'VerifyTransfer' | 'ApproveTransfer' | 'CancelTransfer' | 'RejectTransfer',
  action: string,
  schema: typeof noteBody | typeof reasonBody | null,
) =>
  transferRouter.post(
    `/:transferId/${path}`,
    ...t3(...roles),
    validate(schema ? { params: transferParams, body: schema } : { params: transferParams }),
    async (req: Request, res: Response) => {
      const body = (req.valid?.body ?? {}) as { note?: string; reason?: string };
      const text = body.reason ?? body.note;
      const r = await svc.act(currentUser(req), tid(req), fn, text);
      await audit(req, { action, entityType: 'Transfer', entityId: r.transferId, txId: r.txId, ...(text ? { meta: { text } } : {}) });
      return submitted(res, { txId: r.txId, transferId: r.transferId });
    },
  );

simple('accept', ['CITIZEN'], 'AcceptTransfer', 'transfer.accept', null);
simple('verify', ['LAND_OFFICER'], 'VerifyTransfer', 'transfer.verify', noteBody);
simple('approve', ['REGISTRAR'], 'ApproveTransfer', 'transfer.approve', noteBody);
simple('cancel', ['CITIZEN'], 'CancelTransfer', 'transfer.cancel', reasonBody);
simple('reject', ['LAND_OFFICER', 'REGISTRAR'], 'RejectTransfer', 'transfer.reject', reasonBody);

transferRouter.post(
  '/:transferId/confirm-payments',
  ...t3('LAND_OFFICER'),
  validate({ params: transferParams, body: confirmPaymentsBody }),
  async (req: Request, res: Response) => {
    const body = input<ConfirmPaymentsBody>(req, 'body');
    const r = await svc.confirmPayments(currentUser(req), tid(req), body);
    await audit(req, { action: 'transfer.confirmPayments', entityType: 'Transfer', entityId: r.transferId, txId: r.txId, meta: { paymentReference: body.paymentReference } });
    return submitted(res, { txId: r.txId, transferId: r.transferId });
  },
);
