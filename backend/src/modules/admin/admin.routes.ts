import { type Request, type Response, Router } from 'express';
import { isValidObjectId } from 'mongoose';
import { z } from 'zod';
import { currentUser, requireAuth, requireRole } from '../../core/auth';
import { randomToken } from '../../core/crypto';
import { badRequest, conflict, notFound } from '../../core/errors';
import { forgetIdentity } from '../../core/fabric/wallet';
import { created, input, ok, pageMeta, validate } from '../../core/http';
import { idempotent } from '../../core/idempotency';
import { logger } from '../../core/logger';
import { notify } from '../../core/notify';
import { ROLES, STAFF_ROLES } from '../../core/roles';
import { AuditLog, audit } from '../audit/audit.model';
import { phoneSchema } from '../auth/auth.schema';
import { hashPassword } from '../auth/auth.service';
import { ReauthDevice } from '../auth/reauth-device.model';
import { DeviceToken } from '../notifications/notification.model';
import { publicUser, User } from '../users/user.model';
import { ensureLedgerIdentity, newUserId } from '../users/user.service';
import { LandOffice } from './office.model';

/** SYSTEM_ADMIN tools (CLAUDE.md §2, §7.2, §13 phase 9): users, offices and the read-only audit log. */
export const adminRouter = Router();
adminRouter.use(requireAuth, requireRole('SYSTEM_ADMIN'));

const uid = z.object({ userId: z.string().regex(/^usr_[a-f0-9]{24}$/, 'Not a user ID.') });
const oid = z.object({ id: z.string().refine(isValidObjectId, 'Not a valid ID.') });
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Readable one-time password that satisfies the policy (letters + a digit, 12+ characters). */
const tempPassword = () => `Mk${randomToken(9).replace(/[-_]/g, 'x')}7`;

// -------------------------------------------------------------------------------------------- users
const userQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(80).optional(),
  role: z.enum(ROLES).optional(),
  status: z.enum(['PENDING_VERIFICATION', 'ACTIVE', 'DEACTIVATED']).optional(),
  officeId: z.string().optional(),
});

adminRouter.get('/users', validate({ query: userQuery }), async (req: Request, res: Response) => {
  const q = input<z.infer<typeof userQuery>>(req, 'query');
  const filter: Record<string, unknown> = { deletedAt: null };
  if (q.role) filter.role = q.role;
  if (q.status) filter.status = q.status;
  if (q.officeId) filter.officeId = q.officeId;
  if (q.q) {
    const rx = new RegExp(esc(q.q), 'i');
    filter.$or = [{ fullName: rx }, { email: rx }, { phone: rx }, { userId: q.q }];
  }
  const [items, total] = await Promise.all([User.find(filter).sort({ createdAt: -1 }).skip((q.page - 1) * q.limit).limit(q.limit), User.countDocuments(filter)]);
  return ok(res, items.map(publicUser), pageMeta(q, total));
});

adminRouter.get('/users/:userId', validate({ params: uid }), async (req: Request, res: Response) => {
  const u = await User.findOne({ userId: input<{ userId: string }>(req, 'params').userId, deletedAt: null });
  if (!u) throw notFound('User not found.');
  return ok(res, { ...publicUser(u), ledgerError: u.fabric?.lastError ?? null });
});

const staffRole = z.enum(['LAND_OFFICER', 'REGISTRAR', 'BANK_OFFICER', 'SUPPORT_AGENT', 'SYSTEM_ADMIN'] satisfies (typeof STAFF_ROLES)[number][]);
const bankFields = { bankCode: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,10}$/).optional(), bankName: z.string().trim().min(2).max(80).optional() };
const createUserBody = z
  .object({
    role: staffRole,
    fullName: z.string().trim().min(3).max(100),
    phone: phoneSchema,
    email: z.string().trim().toLowerCase().email(),
    officeId: z.string().refine(isValidObjectId).optional(),
    preferredLanguage: z.enum(['en', 'sw']).default('en'),
    ...bankFields,
  })
  .refine((b) => b.role !== 'BANK_OFFICER' || (b.bankCode && b.bankName), { message: 'Bank officers need a bank code and bank name.', path: ['bankCode'] });

/**
 * Admin creates staff accounts (citizens self-register in the app). A one-time password is shown once and
 * emailed; the ledger identity is enrolled in the background (sign-in works even if the CA is down).
 */
adminRouter.post('/users', idempotent, validate({ body: createUserBody }), async (req: Request, res: Response) => {
  const b = input<z.infer<typeof createUserBody>>(req, 'body');
  if (await User.exists({ $or: [{ phone: b.phone }, { email: b.email }] })) throw conflict('A user with that phone number or email already exists.', null, 'USER_EXISTS');
  if (b.officeId && !(await LandOffice.exists({ _id: b.officeId, deletedAt: null }))) throw badRequest('That land office does not exist.', null, 'OFFICE_NOT_FOUND');
  const password = tempPassword();
  const user = await User.create({
    userId: newUserId(),
    role: b.role,
    fullName: b.fullName,
    phone: b.phone,
    email: b.email,
    officeId: b.officeId,
    preferredLanguage: b.preferredLanguage,
    passwordHash: await hashPassword(password),
    status: 'ACTIVE',
    ...(b.role === 'BANK_OFFICER' ? { bankCode: b.bankCode, bankName: b.bankName } : {}),
  });
  void ensureLedgerIdentity(user);
  await notify.email(b.email, 'Your Milki staff account', `Habari ${b.fullName.split(' ')[0]},\n\nAn administrator created your Milki account.\nSign in at the Milki portal with ${b.email} and this one-time password:\n\n${password}\n\nSign-in also needs a code sent to ${b.phone}.\n\nMilki`).catch((err: Error) => logger.warn({ err: err.message }, 'welcome email failed'));
  await audit(req, { action: 'admin.user.create', entityType: 'User', entityId: user.userId, meta: { role: b.role, officeId: b.officeId ?? null } });
  return created(res, { user: publicUser(user), temporaryPassword: password });
});

const updateUserBody = z
  .object({
    role: z.enum(ROLES).optional(),
    fullName: z.string().trim().min(3).max(100).optional(),
    email: z.string().trim().toLowerCase().email().optional(),
    officeId: z.string().refine(isValidObjectId).nullable().optional(),
    ...bankFields,
  })
  .refine((b) => Object.keys(b).length > 0, 'Nothing to update.');

adminRouter.patch('/users/:userId', idempotent, validate({ params: uid, body: updateUserBody }), async (req: Request, res: Response) => {
  const b = input<z.infer<typeof updateUserBody>>(req, 'body');
  const u = await User.findOne({ userId: input<{ userId: string }>(req, 'params').userId, deletedAt: null });
  if (!u) throw notFound('User not found.');
  const me = currentUser(req);
  if (b.role && b.role !== u.role) {
    if (u.userId === me.userId) throw badRequest('You cannot change your own role.', null, 'SELF_ROLE_CHANGE');
    // Citizens own land on-chain; staff never do. Moving between the two would orphan ledger records.
    if (u.role === 'CITIZEN' || b.role === 'CITIZEN') throw badRequest('Landowner and staff accounts cannot be converted. Create a new account instead.', null, 'ROLE_CHANGE_NOT_ALLOWED');
    if (b.role === 'BANK_OFFICER' && !(b.bankCode ?? u.bankCode)) throw badRequest('Bank officers need a bank code and bank name.', null, 'BANK_REQUIRED');
  }
  if (b.officeId && !(await LandOffice.exists({ _id: b.officeId, deletedAt: null }))) throw badRequest('That land office does not exist.', null, 'OFFICE_NOT_FOUND');
  if (b.email && b.email !== u.email && (await User.exists({ email: b.email }))) throw conflict('Another user already has that email.', null, 'USER_EXISTS');
  const before = { role: u.role, officeId: u.officeId ?? null, bankCode: u.bankCode ?? null };
  const roleOrBankChanged = (b.role && b.role !== u.role) || (b.bankCode && b.bankCode !== u.bankCode);
  u.set({ ...b, officeId: b.officeId === null ? undefined : (b.officeId ?? u.officeId) });
  if (roleOrBankChanged) u.set('fabric', { enrolled: false });
  await u.save();
  if (roleOrBankChanged) {
    // The certificate carries role/bank attributes: drop the wallet entry and re-enroll with the new ones.
    await forgetIdentity(u.userId);
    void ensureLedgerIdentity(u);
  }
  await audit(req, { action: roleOrBankChanged ? 'admin.user.roleChange' : 'admin.user.update', entityType: 'User', entityId: u.userId, meta: { before, fields: Object.keys(b) } });
  return ok(res, publicUser(u));
});

/** Deactivate (soft): sign-in, refresh and re-auth stop working; device credentials and push tokens are removed. */
adminRouter.post('/users/:userId/deactivate', idempotent, validate({ params: uid, body: z.object({ reason: z.string().trim().min(3).max(300) }) }), async (req: Request, res: Response) => {
  const u = await User.findOne({ userId: input<{ userId: string }>(req, 'params').userId, deletedAt: null });
  if (!u) throw notFound('User not found.');
  if (u.userId === currentUser(req).userId) throw badRequest('You cannot deactivate your own account.', null, 'SELF_DEACTIVATE');
  if (u.status === 'DEACTIVATED') return ok(res, publicUser(u));
  u.status = 'DEACTIVATED';
  await u.save();
  await Promise.all([ReauthDevice.updateMany({ userId: u.userId, revokedAt: null }, { revokedAt: new Date() }), DeviceToken.deleteMany({ userId: u.userId })]);
  await audit(req, { action: 'admin.user.deactivate', entityType: 'User', entityId: u.userId, meta: { reason: input<{ reason: string }>(req, 'body').reason } });
  return ok(res, publicUser(u));
});

adminRouter.post('/users/:userId/reactivate', idempotent, validate({ params: uid }), async (req: Request, res: Response) => {
  const u = await User.findOne({ userId: input<{ userId: string }>(req, 'params').userId, deletedAt: null });
  if (!u) throw notFound('User not found.');
  u.status = 'ACTIVE';
  await u.save();
  await audit(req, { action: 'admin.user.reactivate', entityType: 'User', entityId: u.userId });
  return ok(res, publicUser(u));
});

/** New one-time password (shown once, emailed). */
adminRouter.post('/users/:userId/reset-password', idempotent, validate({ params: uid }), async (req: Request, res: Response) => {
  const u = await User.findOne({ userId: input<{ userId: string }>(req, 'params').userId, deletedAt: null });
  if (!u) throw notFound('User not found.');
  const password = tempPassword();
  u.passwordHash = await hashPassword(password);
  await u.save();
  if (u.email) await notify.email(u.email, 'Your Milki password was reset', `An administrator reset your Milki password. Your one-time password is:\n\n${password}\n\nMilki`).catch(() => undefined);
  await audit(req, { action: 'admin.user.resetPassword', entityType: 'User', entityId: u.userId });
  return ok(res, { user: publicUser(u), temporaryPassword: password });
});

// ------------------------------------------------------------------------------------------ offices
const officeBody = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{2,20}$/, 'Use letters, digits and hyphens, e.g. DSM-KIN.'),
  name: z.string().trim().min(3).max(120),
  region: z.string().trim().min(2).max(60),
  district: z.string().trim().min(2).max(60),
  address: z.string().trim().max(200).default(''),
  phone: z.string().trim().max(30).default(''),
  email: z.string().trim().toLowerCase().max(120).default(''),
});

adminRouter.post('/offices', idempotent, validate({ body: officeBody }), async (req: Request, res: Response) => {
  const b = input<z.infer<typeof officeBody>>(req, 'body');
  if (await LandOffice.exists({ code: b.code })) throw conflict('An office with that code already exists.', null, 'OFFICE_EXISTS');
  const o = await LandOffice.create(b);
  await audit(req, { action: 'admin.office.create', entityType: 'LandOffice', entityId: o.code });
  return created(res, o.toObject());
});

adminRouter.patch('/offices/:id', idempotent, validate({ params: oid, body: officeBody.partial().omit({ code: true }) }), async (req: Request, res: Response) => {
  const o = await LandOffice.findOneAndUpdate({ _id: input<{ id: string }>(req, 'params').id, deletedAt: null }, { $set: input(req, 'body') }, { returnDocument: 'after' }).lean();
  if (!o) throw notFound('Office not found.');
  await audit(req, { action: 'admin.office.update', entityType: 'LandOffice', entityId: o.code });
  return ok(res, o);
});

adminRouter.delete('/offices/:id', idempotent, validate({ params: oid }), async (req: Request, res: Response) => {
  const o = await LandOffice.findOne({ _id: input<{ id: string }>(req, 'params').id, deletedAt: null });
  if (!o) throw notFound('Office not found.');
  const staff = await User.countDocuments({ officeId: String(o._id), status: 'ACTIVE', deletedAt: null });
  if (staff > 0) throw conflict(`${staff} active staff member(s) belong to this office. Move them first.`, { staff }, 'OFFICE_HAS_STAFF');
  o.deletedAt = new Date();
  await o.save();
  await audit(req, { action: 'admin.office.delete', entityType: 'LandOffice', entityId: o.code });
  return ok(res, { deleted: true });
});

// ---------------------------------------------------------------------------------------- audit log
const auditQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  action: z.string().trim().max(80).optional(),
  actor: z.string().trim().max(60).optional(),
  entityType: z.string().trim().max(40).optional(),
  entityId: z.string().trim().max(80).optional(),
  outcome: z.enum(['SUCCESS', 'FAILURE']).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

/** Read-only (CLAUDE.md §7.2): there is no endpoint that changes or deletes audit entries. */
adminRouter.get('/audit', validate({ query: auditQuery }), async (req: Request, res: Response) => {
  const q = input<z.infer<typeof auditQuery>>(req, 'query');
  const filter: Record<string, unknown> = {};
  if (q.action) filter.action = new RegExp(`^${esc(q.action)}`);
  if (q.actor) filter['actor.userId'] = q.actor;
  if (q.entityType) filter.entityType = q.entityType;
  if (q.entityId) filter.entityId = q.entityId;
  if (q.outcome) filter.outcome = q.outcome;
  if (q.from || q.to) filter.at = { ...(q.from ? { $gte: q.from } : {}), ...(q.to ? { $lte: q.to } : {}) };
  const [items, total] = await Promise.all([AuditLog.find(filter).sort({ at: -1 }).skip((q.page - 1) * q.limit).limit(q.limit).lean(), AuditLog.countDocuments(filter)]);
  const actorIds = [...new Set(items.map((i) => i.actor?.userId).filter((x): x is string => !!x))];
  const names = new Map((await User.find({ userId: { $in: actorIds } }, { userId: 1, fullName: 1 }).lean()).map((u) => [u.userId, u.fullName]));
  return ok(res, items.map((i) => ({ ...i, actorName: i.actor?.userId ? (names.get(i.actor.userId) ?? null) : null })), pageMeta(q, total));
});

// ----------------------------------------------------------------------------- staff-visible offices
export const officeRouter = Router();
officeRouter.use(requireAuth, requireRole(...STAFF_ROLES));
officeRouter.get('/', async (_req: Request, res: Response) => ok(res, await LandOffice.find({ deletedAt: null }).sort({ region: 1, name: 1 }).lean()));
