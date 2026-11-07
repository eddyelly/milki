import { Router } from 'express';
import { requireAuth, requireReauth, requireRole } from '../../core/auth';
import { validate } from '../../core/http';
import { idempotent } from '../../core/idempotency';
import * as c from './parcel.controller';
import { listQuery, parcelParams, reasonBody, registerParcelBody, updateParcelBody } from './parcel.schema';

export const parcelRouter = Router();
parcelRouter.use(requireAuth);

// Reads (any signed-in role; citizens are limited to their own parcels in the service).
parcelRouter.get('/', validate({ query: listQuery }), c.list);
parcelRouter.get('/:parcelId', validate({ params: parcelParams }), c.get);
parcelRouter.get('/:parcelId/history', validate({ params: parcelParams }), c.history);
parcelRouter.get('/:parcelId/encumbrances', validate({ params: parcelParams }), c.related('encumbrances'));
parcelRouter.get('/:parcelId/disputes', validate({ params: parcelParams }), c.related('disputes'));
parcelRouter.get('/:parcelId/transfers', validate({ params: parcelParams }), c.related('transfers'));
parcelRouter.get('/:parcelId/documents', validate({ params: parcelParams }), c.related('documents'));

// Ledger writes: REGISTRAR, T3 re-authentication, Idempotency-Key (CLAUDE.md §8). Respond 202 { txId }.
// Order matters: a replay of a completed request is answered before the single-use re-auth token is checked.
const t3 = [requireRole('REGISTRAR'), idempotent, requireReauth] as const;
parcelRouter.post('/', ...t3, validate({ body: registerParcelBody }), c.register);
parcelRouter.patch('/:parcelId', ...t3, validate({ params: parcelParams, body: updateParcelBody }), c.update);
parcelRouter.post('/:parcelId/freeze', ...t3, validate({ params: parcelParams, body: reasonBody }), c.changeState('freeze'));
parcelRouter.post('/:parcelId/unfreeze', ...t3, validate({ params: parcelParams, body: reasonBody }), c.changeState('unfreeze'));
parcelRouter.post('/:parcelId/retire', ...t3, validate({ params: parcelParams, body: reasonBody }), c.changeState('retire'));
