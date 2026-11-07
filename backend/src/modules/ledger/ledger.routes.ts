import { type Request, type Response, Router } from 'express';
import { z } from 'zod';
import { currentUser, requireAuth } from '../../core/auth';
import { forbidden, notFound } from '../../core/errors';
import { LedgerTx } from '../../core/fabric/ledger-tx.model';
import { input, ok, validate } from '../../core/http';

export const ledgerRouter = Router();
ledgerRouter.use(requireAuth);

const txParams = z.object({ txId: z.string().regex(/^[a-f0-9]{64}$/, 'Not a transaction ID.') });

/** Status of a submitted ledger transaction — fallback for clients that missed the `ledger:tx` socket event. */
ledgerRouter.get('/tx/:txId', validate({ params: txParams }), async (req: Request, res: Response) => {
  const user = currentUser(req);
  const tx = await LedgerTx.findOne({ txId: input<{ txId: string }>(req, 'params').txId }, { _id: 0 }).lean();
  if (!tx) throw notFound('No transaction with that ID was submitted through Milki.', 'TX_NOT_FOUND');
  if (tx.userId !== user.userId && user.role === 'CITIZEN') throw forbidden();
  return ok(res, tx);
});
