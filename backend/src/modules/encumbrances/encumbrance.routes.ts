import { type Request, type Response, Router } from 'express';
import { z } from 'zod';
import { currentUser, requireAuth, requireReauth, requireRole } from '../../core/auth';
import { forbidden } from '../../core/errors';
import { ledger } from '../../core/fabric/ledger';
import { input, ok, pageMeta, submitted, validate } from '../../core/http';
import { idempotent } from '../../core/idempotency';
import { audit } from '../audit/audit.model';
import { parcelParams } from '../parcels/parcel.schema';
import { User } from '../users/user.model';
import { toWalletUser } from '../users/user.service';
import { addEncumbrance, EncumbranceCache, type LedgerEncumbrance, releaseEncumbrance, updateEncumbrance } from './encumbrance.service';

/**
 * Encumbrances (CLAUDE.md §7.1): banks add, update and release their own mortgages/charges. Every write is T3.
 * The chaincode enforces that only the lending bank (certificate attribute `bank`) may change one.
 */
export const encumbranceRouter = Router();
encumbranceRouter.use(requireAuth);

export const encumbranceParams = z.object({
  encumbranceId: z
    .string()
    .transform((s) => s.toUpperCase())
    .pipe(z.string().regex(/^ENC-[A-F0-9]{16}$/, 'Encumbrance IDs look like ENC-0A1B2C3D4E5F6789.')),
});

const sha = z.string().regex(/^[a-f0-9]{64}$/, 'termsHash must be a SHA-256 (64 lowercase hex characters).');
export const addBody = z.object({
  type: z.enum(['MORTGAGE', 'CHARGE', 'CAVEAT', 'LIEN']),
  amount: z.number().positive().max(1e13),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).default('TZS'),
  /** The bank's own loan reference — no borrower personal data (rule 4). */
  reference: z.string().trim().min(2).max(80),
  termsHash: sha.nullable().optional(),
});
export const updateBody = z
  .object({ amount: z.number().positive().max(1e13).optional(), currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).optional(), reference: z.string().trim().min(2).max(80).optional(), termsHash: sha.nullable().optional() })
  .refine((b) => Object.keys(b).length > 0, 'Nothing to update.');
export const releaseBody = z.object({ reason: z.string().trim().min(3).max(500) });

const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['ACTIVE', 'RELEASED']).optional(),
  q: z.string().trim().max(60).optional(),
});

/** Banks see only their own book; registry staff see all. Lists come from the cache. */
encumbranceRouter.get('/', requireRole('BANK_OFFICER', 'REGISTRAR', 'LAND_OFFICER', 'SYSTEM_ADMIN'), validate({ query: listQuery }), async (req: Request, res: Response) => {
  const q = input<z.infer<typeof listQuery>>(req, 'query');
  const user = currentUser(req);
  const filter: Record<string, unknown> = {};
  if (user.role === 'BANK_OFFICER') {
    const me = await User.findOne({ userId: user.userId }, { bankCode: 1 }).lean();
    if (!me?.bankCode) throw forbidden('Your account is not linked to a bank.');
    filter.lenderCode = me.bankCode;
  }
  if (q.status) filter.status = q.status;
  if (q.q) filter.$or = [{ parcelId: new RegExp(q.q.replace(/[^A-Za-z0-9-]/g, ''), 'i') }, { reference: new RegExp(q.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }];
  const [items, total] = await Promise.all([
    EncumbranceCache.find(filter).sort({ ledgerUpdatedAt: -1 }).skip((q.page - 1) * q.limit).limit(q.limit).lean(),
    EncumbranceCache.countDocuments(filter),
  ]);
  return ok(res, items, { ...pageMeta(q, total), source: 'cache' });
});

/** Single record straight from the ledger (rule 3). */
encumbranceRouter.get('/:encumbranceId', requireRole('BANK_OFFICER', 'REGISTRAR', 'LAND_OFFICER', 'SYSTEM_ADMIN', 'SUPPORT_AGENT'), validate({ params: encumbranceParams }), async (req: Request, res: Response) =>
  ok(res, await ledger.evaluate<LedgerEncumbrance>('service', 'GetEncumbrance', [input<{ encumbranceId: string }>(req, 'params').encumbranceId]), { source: 'ledger' }),
);

const t3 = [requireRole('BANK_OFFICER'), idempotent, requireReauth] as const;
const eid = (req: Request) => input<{ encumbranceId: string }>(req, 'params').encumbranceId;

encumbranceRouter.patch('/:encumbranceId', ...t3, validate({ params: encumbranceParams, body: updateBody }), async (req: Request, res: Response) => {
  const r = await updateEncumbrance(await toWalletUser(currentUser(req)), eid(req), input(req, 'body'));
  await audit(req, { action: 'encumbrance.update', entityType: 'Encumbrance', entityId: eid(req), txId: r.txId, meta: { fields: Object.keys(input<object>(req, 'body')) } });
  return submitted(res, { txId: r.txId, encumbranceId: eid(req), parcelId: r.result.parcelId });
});

encumbranceRouter.post('/:encumbranceId/release', ...t3, validate({ params: encumbranceParams, body: releaseBody }), async (req: Request, res: Response) => {
  const r = await releaseEncumbrance(await toWalletUser(currentUser(req)), eid(req), input<{ reason: string }>(req, 'body').reason);
  await audit(req, { action: 'encumbrance.release', entityType: 'Encumbrance', entityId: eid(req), txId: r.txId, meta: { parcelId: r.result.parcelId } });
  return submitted(res, { txId: r.txId, encumbranceId: eid(req), parcelId: r.result.parcelId });
});

/** Mounted under /parcels: POST /parcels/:parcelId/encumbrances */
export const parcelEncumbranceRouter = Router({ mergeParams: true });
parcelEncumbranceRouter.post('/:parcelId/encumbrances', requireAuth, ...t3, validate({ params: parcelParams, body: addBody }), async (req: Request, res: Response) => {
  const { parcelId } = input<{ parcelId: string }>(req, 'params');
  const user = currentUser(req);
  const me = await User.findOne({ userId: user.userId }, { bankName: 1, bankCode: 1 }).lean();
  if (!me?.bankCode) throw forbidden('Your account is not linked to a bank.');
  const r = await addEncumbrance(await toWalletUser(user), me.bankName ?? me.bankCode, parcelId, input(req, 'body'));
  await audit(req, { action: 'encumbrance.add', entityType: 'Encumbrance', entityId: r.result.encumbranceId, txId: r.txId, meta: { parcelId, type: r.result.type } });
  return submitted(res, { txId: r.txId, encumbranceId: r.result.encumbranceId, parcelId });
});
