import { randomBytes } from 'node:crypto';
import { type Request, type Response, Router } from 'express';
import { z } from 'zod';
import { currentUser, requireAuth, requireRole } from '../../core/auth';
import { conflict, notFound } from '../../core/errors';
import { created, input, ok, validate } from '../../core/http';
import { idempotent } from '../../core/idempotency';
import { audit } from '../audit/audit.model';
import { ApiClient, newApiKey, PARTNER_SCOPES, publicClient } from './api-client.model';

/** SYSTEM_ADMIN manages bank API clients (CLAUDE.md §7.2). Keys are shown exactly once (create and rotate). */
export const apiClientRouter = Router();
apiClientRouter.use(requireAuth, requireRole('SYSTEM_ADMIN'));

const params = z.object({ clientId: z.string().regex(/^cli_[a-f0-9]{16}$/, 'Not an API client ID.') });
const cid = (req: Request) => input<{ clientId: string }>(req, 'params').clientId;
const scopes = z.array(z.enum(PARTNER_SCOPES)).min(1, 'Choose at least one scope.').transform((s) => [...new Set(s)]);

const createBody = z.object({
  name: z.string().trim().min(3).max(80),
  bankCode: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,10}$/),
  bankName: z.string().trim().min(2).max(80),
  scopes,
  rateLimitPerMin: z.number().int().min(1).max(6000).default(60),
});

apiClientRouter.get('/', async (_req: Request, res: Response) => ok(res, (await ApiClient.find().sort({ status: 1, createdAt: -1 }).lean()).map(publicClient)));

apiClientRouter.post('/', idempotent, validate({ body: createBody }), async (req: Request, res: Response) => {
  const b = input<z.infer<typeof createBody>>(req, 'body');
  const k = newApiKey();
  const c = await ApiClient.create({ ...b, clientId: `cli_${randomBytes(8).toString('hex')}`, keyPrefix: k.prefix, keyHash: k.hash, createdBy: currentUser(req).userId });
  await audit(req, { action: 'admin.apiClient.create', entityType: 'ApiClient', entityId: c.clientId, meta: { bankCode: b.bankCode, scopes: b.scopes } });
  return created(res, { client: publicClient(c), apiKey: k.key });
});

const updateBody = z
  .object({ name: z.string().trim().min(3).max(80).optional(), scopes: scopes.optional(), rateLimitPerMin: z.number().int().min(1).max(6000).optional() })
  .refine((b) => Object.keys(b).length > 0, 'Nothing to update.');

apiClientRouter.patch('/:clientId', idempotent, validate({ params, body: updateBody }), async (req: Request, res: Response) => {
  const c = await ApiClient.findOne({ clientId: cid(req) });
  if (!c) throw notFound('API client not found.');
  if (c.status === 'REVOKED') throw conflict('This client is revoked. Create a new one instead.', null, 'CLIENT_REVOKED');
  const before = { scopes: c.scopes, rateLimitPerMin: c.rateLimitPerMin };
  c.set(input(req, 'body'));
  await c.save();
  await audit(req, { action: 'admin.apiClient.update', entityType: 'ApiClient', entityId: c.clientId, meta: { before, after: input(req, 'body') } });
  return ok(res, publicClient(c));
});

/** New key, old one stops working immediately. */
apiClientRouter.post('/:clientId/rotate', idempotent, validate({ params }), async (req: Request, res: Response) => {
  const c = await ApiClient.findOne({ clientId: cid(req) });
  if (!c) throw notFound('API client not found.');
  if (c.status === 'REVOKED') throw conflict('This client is revoked. Create a new one instead.', null, 'CLIENT_REVOKED');
  const k = newApiKey();
  c.set({ keyPrefix: k.prefix, keyHash: k.hash, rotatedAt: new Date() });
  await c.save();
  await audit(req, { action: 'admin.apiClient.rotate', entityType: 'ApiClient', entityId: c.clientId });
  return ok(res, { client: publicClient(c), apiKey: k.key });
});

apiClientRouter.post('/:clientId/revoke', idempotent, validate({ params, body: z.object({ reason: z.string().trim().min(3).max(300) }) }), async (req: Request, res: Response) => {
  const c = await ApiClient.findOne({ clientId: cid(req) });
  if (!c) throw notFound('API client not found.');
  if (c.status !== 'REVOKED') {
    c.set({ status: 'REVOKED', revokedAt: new Date(), revokedBy: currentUser(req).userId });
    await c.save();
    await audit(req, { action: 'admin.apiClient.revoke', entityType: 'ApiClient', entityId: c.clientId, meta: { reason: input<{ reason: string }>(req, 'body').reason } });
  }
  return ok(res, publicClient(c));
});
