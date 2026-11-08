import { type NextFunction, type Request, type Response, Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { RedisStore, type RedisReply } from 'rate-limit-redis';
import { z } from 'zod';
import { piiHash, safeEqual } from '../../core/crypto';
import { redis } from '../../core/datastores';
import { AppError, forbidden, notFound } from '../../core/errors';
import { ledger } from '../../core/fabric/ledger';
import { LedgerTx } from '../../core/fabric/ledger-tx.model';
import type { WalletUser } from '../../core/fabric/wallet';
import { input, ok, pageMeta, submitted, validate } from '../../core/http';
import { idempotent } from '../../core/idempotency';
import { audit } from '../audit/audit.model';
import { nidaSchema } from '../auth/auth.schema';
import { addBody, encumbranceParams, releaseBody, updateBody } from '../encumbrances/encumbrance.routes';
import { addEncumbrance, EncumbranceCache, type LedgerEncumbrance, releaseEncumbrance, updateEncumbrance } from '../encumbrances/encumbrance.service';
import { parcelParams } from '../parcels/parcel.schema';
import type { LedgerParcel } from '../parcels/parcel.types';
import { ApiClient, keyMatches, parseApiKey, type PartnerScope } from './api-client.model';

/**
 * Partner API for banks (CLAUDE.md §12): `x-api-key` (stored hashed), scopes `parcels:verify` and
 * `encumbrances:write`, a per-client rate limit, and every call audited. Reads go straight to the ledger.
 * Writes are signed by a per-client bank identity (role BANK_OFFICER, attribute bank=<code>), so the chaincode's
 * "only the lending bank may change it" guard applies to API clients exactly as to portal users.
 */
export const partnerRouter = Router();

const deny = (message: string, code: string, status = 401) => new AppError(status, code, message);

async function apiKeyAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const raw = req.header('x-api-key') ?? '';
  const parsed = parseApiKey(raw);
  if (!parsed) return next(deny('Send your Milki API key in the x-api-key header.', 'API_KEY_REQUIRED'));
  const c = await ApiClient.findOne({ keyPrefix: parsed.prefix }).lean();
  if (!c || !keyMatches(raw, c.keyHash)) return next(deny('That API key is not valid.', 'API_KEY_INVALID'));
  if (c.status !== 'ACTIVE') return next(deny('This API key has been revoked.', 'API_KEY_REVOKED'));
  req.partner = { clientId: c.clientId, name: c.name, bankCode: c.bankCode, bankName: c.bankName, scopes: c.scopes, rateLimitPerMin: c.rateLimitPerMin };
  // Idempotency keys and audit entries are scoped to the client.
  req.user = { userId: `api_${c.clientId}`, role: 'BANK_OFFICER' };
  // lastUsedAt at most once a minute per client.
  if (!c.lastUsedAt || Date.now() - c.lastUsedAt.getTime() > 60_000) void ApiClient.updateOne({ _id: c._id }, { lastUsedAt: new Date() }).exec();
  next();
}

const perClientLimit = rateLimit({
  windowMs: 60_000,
  limit: (req) => req.partner?.rateLimitPerMin ?? 60,
  keyGenerator: (req) => req.partner?.clientId ?? 'unknown',
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  store: new RedisStore({ prefix: 'rl:partner:', sendCommand: (command: string, ...args: string[]) => redis.call(command, ...args) as Promise<RedisReply> }),
  message: { error: { code: 'RATE_LIMITED', message: 'Rate limit reached for this API key. Try again in a minute.', details: null } },
});

/** Every partner call is audited (method, route, status, client), never with request bodies (they may hold PII). */
function auditCall(req: Request, res: Response, next: NextFunction): void {
  const started = Date.now();
  res.on('finish', () => {
    const p = req.partner;
    void audit(req, {
      // Rejected keys are audited too (no client yet), so abuse shows up in the log.
      action: p ? `partner.${req.method.toLowerCase()}.${(req.route?.path as string | undefined) ?? req.path}` : 'partner.denied',
      entityType: 'ApiClient',
      entityId: p?.clientId ?? 'unknown',
      outcome: res.statusCode < 400 ? 'SUCCESS' : 'FAILURE',
      actor: p ? { userId: `api_${p.clientId}`, role: 'PARTNER' } : null,
      meta: { status: res.statusCode, path: req.originalUrl.split('?')[0], ms: Date.now() - started, ...(p ? { bankCode: p.bankCode } : {}) },
    });
  });
  next();
}

const scope = (s: PartnerScope) => (req: Request, _res: Response, next: NextFunction) =>
  req.partner?.scopes.includes(s) ? next() : next(forbidden(`This API key does not have the ${s} scope.`, 'SCOPE_REQUIRED'));

partnerRouter.use(auditCall, apiKeyAuth, perClientLimit);

const who = (req: Request): WalletUser => ({ userId: `api_${req.partner!.clientId}`, role: 'BANK_OFFICER', bankCode: req.partner!.bankCode });

// ------------------------------------------------------------------------------------------- verify
/** Ownership-relevant facts, straight from the ledger. No owner identity is returned. */
partnerRouter.get('/parcels/:parcelId', scope('parcels:verify'), validate({ params: parcelParams }), async (req: Request, res: Response) => {
  const p = await ledger.evaluate<LedgerParcel>('service', 'GetParcel', [input<{ parcelId: string }>(req, 'params').parcelId]);
  const enc = await ledger.evaluate<LedgerEncumbrance[]>('service', 'GetEncumbrances', [p.parcelId]);
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
      ownershipVersion: p.ownershipVersion,
      frozen: p.frozen,
      disputed: p.openDisputeIds.length > 0,
      transferInProgress: p.activeTransferId !== null,
      encumbrances: enc.filter((e) => e.status === 'ACTIVE').map((e) => ({ encumbranceId: e.encumbranceId, type: e.type, lenderCode: e.lenderCode, lenderName: e.lenderName, ...(e.lenderCode === req.partner!.bankCode ? { amount: e.amount, currency: e.currency, reference: e.reference } : {}) })),
      lastTxId: p.lastTxId,
      updatedAt: p.updatedAt,
      verifiedAt: new Date().toISOString(),
    },
    { source: 'ledger' },
  );
});

/**
 * "Does this person own this parcel?", the bank sends the borrower's NIDA number (POST, so it never sits in URLs
 * or access logs); we compare its salted hash with the ledger's owner hash and answer yes/no only.
 */
partnerRouter.post('/parcels/:parcelId/verify-owner', scope('parcels:verify'), validate({ params: parcelParams, body: z.object({ nida: nidaSchema }) }), async (req: Request, res: Response) => {
  const p = await ledger.evaluate<LedgerParcel>('service', 'GetParcel', [input<{ parcelId: string }>(req, 'params').parcelId]);
  const matches = !!p.ownerNidaHash && safeEqual(piiHash(input<{ nida: string }>(req, 'body').nida), p.ownerNidaHash);
  return ok(res, { parcelId: p.parcelId, ownerMatches: matches, status: p.status, ownershipVersion: p.ownershipVersion, verifiedAt: new Date().toISOString() }, { source: 'ledger' });
});

// -------------------------------------------------------------------------------------- encumbrances
partnerRouter.get(
  '/encumbrances',
  scope('encumbrances:write'),
  validate({ query: z.object({ status: z.enum(['ACTIVE', 'RELEASED']).optional(), page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(50) }) }),
  async (req: Request, res: Response) => {
    const q = input<{ status?: string; page: number; limit: number }>(req, 'query');
    const filter = { lenderCode: req.partner!.bankCode, ...(q.status ? { status: q.status } : {}) };
    const [items, total] = await Promise.all([EncumbranceCache.find(filter, { _id: 0, createdAt: 0, updatedAt: 0 }).sort({ ledgerUpdatedAt: -1 }).skip((q.page - 1) * q.limit).limit(q.limit).lean(), EncumbranceCache.countDocuments(filter)]);
    return ok(res, items, { ...pageMeta(q, total), source: 'cache' });
  },
);

partnerRouter.post('/parcels/:parcelId/encumbrances', scope('encumbrances:write'), idempotent, validate({ params: parcelParams, body: addBody }), async (req: Request, res: Response) => {
  const { parcelId } = input<{ parcelId: string }>(req, 'params');
  const r = await addEncumbrance(who(req), req.partner!.bankName, parcelId, input(req, 'body'));
  return submitted(res, { txId: r.txId, encumbranceId: r.result.encumbranceId, parcelId });
});

partnerRouter.patch('/encumbrances/:encumbranceId', scope('encumbrances:write'), idempotent, validate({ params: encumbranceParams, body: updateBody }), async (req: Request, res: Response) => {
  const id = input<{ encumbranceId: string }>(req, 'params').encumbranceId;
  const r = await updateEncumbrance(who(req), id, input(req, 'body'));
  return submitted(res, { txId: r.txId, encumbranceId: id, parcelId: r.result.parcelId });
});

partnerRouter.post('/encumbrances/:encumbranceId/release', scope('encumbrances:write'), idempotent, validate({ params: encumbranceParams, body: releaseBody }), async (req: Request, res: Response) => {
  const id = input<{ encumbranceId: string }>(req, 'params').encumbranceId;
  const r = await releaseEncumbrance(who(req), id, input<{ reason: string }>(req, 'body').reason);
  return submitted(res, { txId: r.txId, encumbranceId: id, parcelId: r.result.parcelId });
});

/** Commit status for a partner's own submission (no socket for machine clients). */
partnerRouter.get('/tx/:txId', async (req: Request, res: Response) => {
  const tx = await LedgerTx.findOne({ txId: String(req.params.txId), userId: `api_${req.partner!.clientId}` }, { _id: 0, txId: 1, status: 1, blockNumber: 1, error: 1, fn: 1 }).lean();
  if (!tx) throw notFound('Unknown transaction for this API key.', 'TX_NOT_FOUND');
  return ok(res, tx);
});
