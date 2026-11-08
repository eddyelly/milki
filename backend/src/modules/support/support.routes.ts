import { type Request, type Response, Router } from 'express';
import { isValidObjectId } from 'mongoose';
import multer from 'multer';
import { z } from 'zod';
import { currentUser, requireAuth, requireRole } from '../../core/auth';
import { notFound } from '../../core/errors';
import { created, input, ok, pageMeta, validate } from '../../core/http';
import { idempotent } from '../../core/idempotency';
import { getObjectBuffer } from '../../core/storage';
import { audit } from '../audit/audit.model';
import { User } from '../users/user.model';
import { CannedResponse, Ticket, TICKET_CATEGORIES, TICKET_PRIORITIES, TICKET_STATUSES, TicketMessage } from './support.models';
import { agentsOnline, isStaff, STAFF } from './support.socket';
import * as svc from './ticket.service';

const objectId = z.string().refine(isValidObjectId, 'Not a valid ID.');
const idParams = z.object({ id: objectId });
const msgParams = z.object({ id: objectId, messageId: objectId });
const tid = (req: Request) => input<{ id: string }>(req, 'params').id;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: svc.MAX_ATTACHMENT_BYTES, files: 1, fields: 10 } }).single('file');

// ------------------------------------------------------------------------------------------ tickets
/** Support tickets (CLAUDE.md §11). Off-chain, so T1/T2 tiers; every write is idempotent and audited. */
export const ticketRouter = Router();
ticketRouter.use(requireAuth);

const optionalId = (re: RegExp, msg: string) =>
  z.preprocess((v) => (v === '' || v === undefined ? null : v), z.string().trim().toUpperCase().regex(re, msg).nullable()).optional();

const createBody = z.object({
  category: z.enum(TICKET_CATEGORIES),
  priority: z.enum(TICKET_PRIORITIES).default('NORMAL'),
  subject: z.string().trim().min(4, 'Give the ticket a short subject.').max(140),
  description: z.string().trim().min(10, 'Describe the problem in a sentence or two.').max(5000),
  parcelId: optionalId(/^[A-Z]{2,4}-[A-Z]{2,4}-[0-9A-Z]{1,8}-[0-9A-Z]{1,8}$/, 'Not a valid parcel ID.'),
  transferId: optionalId(/^TRF-[A-F0-9]{16}$/, 'Not a valid transfer ID.'),
});

ticketRouter.post('/', idempotent, upload, validate({ body: createBody }), async (req: Request, res: Response) => {
  const t = await svc.createTicket(currentUser(req), input(req, 'body'), req.file);
  await audit(req, { action: 'support.ticket.create', entityType: 'Ticket', entityId: t.number, meta: { category: t.category, priority: t.priority } });
  return created(res, t);
});

const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(100).optional(),
  status: z.string().regex(new RegExp(`^(${TICKET_STATUSES.join('|')})(,(${TICKET_STATUSES.join('|')}))*$`)).optional(),
  priority: z.string().regex(new RegExp(`^(${TICKET_PRIORITIES.join('|')})(,(${TICKET_PRIORITIES.join('|')}))*$`)).optional(),
  category: z.enum(TICKET_CATEGORIES).optional(),
  assignee: z.string().trim().max(40).optional(),
  tag: z.string().trim().max(30).optional(),
  sort: z.enum(['-updatedAt', 'updatedAt', '-createdAt', 'createdAt', 'sla', 'priority', '-lastMessageAt']).default('-updatedAt'),
});

ticketRouter.get('/', validate({ query: listQuery }), async (req: Request, res: Response) => {
  const q = input<z.infer<typeof listQuery>>(req, 'query');
  const r = await svc.listTickets(currentUser(req), q);
  return ok(res, r.items, pageMeta(q, r.total));
});

ticketRouter.get('/:id', validate({ params: idParams }), async (req: Request, res: Response) => ok(res, await svc.getTicket(currentUser(req), tid(req))));

const updateBody = z
  .object({
    status: z.enum(TICKET_STATUSES).optional(),
    priority: z.enum(TICKET_PRIORITIES).optional(),
    assigneeId: z.string().regex(/^usr_[a-f0-9]{24}$/).nullable().optional(),
    tags: z.array(z.string().trim().toLowerCase().min(1).max(30)).max(10).optional(),
  })
  .refine((b) => Object.keys(b).length > 0, 'Nothing to update.');

ticketRouter.patch('/:id', requireRole(...STAFF), idempotent, validate({ params: idParams, body: updateBody }), async (req: Request, res: Response) => {
  const { view, before } = await svc.updateTicket(currentUser(req), tid(req), input(req, 'body'));
  await audit(req, { action: 'support.ticket.update', entityType: 'Ticket', entityId: view.number, meta: { before, after: input(req, 'body') } });
  return ok(res, view);
});

ticketRouter.post('/:id/claim', requireRole(...STAFF), idempotent, validate({ params: idParams }), async (req: Request, res: Response) => {
  const { view } = await svc.claimTicket(currentUser(req), tid(req));
  await audit(req, { action: 'support.ticket.claim', entityType: 'Ticket', entityId: view.number });
  return ok(res, view);
});

ticketRouter.post('/:id/close', idempotent, validate({ params: idParams }), async (req: Request, res: Response) => {
  const t = await svc.closeTicket(currentUser(req), tid(req));
  await audit(req, { action: 'support.ticket.close', entityType: 'Ticket', entityId: t.number });
  return ok(res, t);
});

ticketRouter.post('/:id/reopen', idempotent, validate({ params: idParams }), async (req: Request, res: Response) => {
  const t = await svc.reopenTicket(currentUser(req), tid(req));
  await audit(req, { action: 'support.ticket.reopen', entityType: 'Ticket', entityId: t.number });
  return ok(res, t);
});

const ratingBody = z.object({ stars: z.number().int().min(1).max(5), comment: z.string().trim().max(1000).optional() });
ticketRouter.post('/:id/rating', idempotent, validate({ params: idParams, body: ratingBody }), async (req: Request, res: Response) => {
  const t = await svc.rateTicket(currentUser(req), tid(req), input(req, 'body'));
  await audit(req, { action: 'support.ticket.rate', entityType: 'Ticket', entityId: t.number, meta: { stars: input<{ stars: number }>(req, 'body').stars } });
  return ok(res, t);
});

/** Admin soft delete (§7.2). */
ticketRouter.delete('/:id', requireRole('SYSTEM_ADMIN'), idempotent, validate({ params: idParams }), async (req: Request, res: Response) => {
  const r = await svc.softDeleteTicket(currentUser(req), tid(req));
  await audit(req, { action: 'support.ticket.delete', entityType: 'Ticket', entityId: r.number });
  return ok(res, { deleted: true });
});

ticketRouter.get('/:id/context', requireRole(...STAFF), validate({ params: idParams }), async (req: Request, res: Response) =>
  ok(res, await svc.ticketContext(currentUser(req), tid(req)), { readOnly: true }),
);

ticketRouter.post('/:id/escalate', requireRole(...STAFF), idempotent, validate({ params: idParams, body: z.object({ note: z.string().trim().min(10).max(2000) }) }), async (req: Request, res: Response) => {
  const e = await svc.escalate(currentUser(req), tid(req), input<{ note: string }>(req, 'body').note);
  await audit(req, { action: 'support.ticket.escalate', entityType: 'Ticket', entityId: e.ticketNumber, meta: { escalationId: String(e._id) } });
  return created(res, { ...e, id: String(e._id) });
});

// ----------------------------------------------------------------------------------------- messages
ticketRouter.get('/:id/messages', validate({ params: idParams }), async (req: Request, res: Response) => ok(res, await svc.listMessages(currentUser(req), tid(req))));

const messageBody = z.object({
  body: z.string().max(5000).default(''),
  internal: z.preprocess((v) => v === true || v === 'true', z.boolean()).default(false),
});

ticketRouter.post('/:id/messages', idempotent, upload, validate({ params: idParams, body: messageBody }), async (req: Request, res: Response) => {
  const b = input<z.infer<typeof messageBody>>(req, 'body');
  const m = await svc.postMessage(currentUser(req), tid(req), b, req.file);
  await audit(req, { action: b.internal ? 'support.note.create' : 'support.message.create', entityType: 'TicketMessage', entityId: m.id, meta: { ticketId: tid(req), attachment: !!req.file } });
  return created(res, m);
});

ticketRouter.patch('/:id/messages/:messageId', idempotent, validate({ params: msgParams, body: z.object({ body: z.string().trim().min(1).max(5000) }) }), async (req: Request, res: Response) => {
  const p = input<{ id: string; messageId: string }>(req, 'params');
  const m = await svc.editMessage(currentUser(req), p.id, p.messageId, input<{ body: string }>(req, 'body').body);
  await audit(req, { action: 'support.message.edit', entityType: 'TicketMessage', entityId: p.messageId });
  return ok(res, m);
});

ticketRouter.delete('/:id/messages/:messageId', idempotent, validate({ params: msgParams }), async (req: Request, res: Response) => {
  const p = input<{ id: string; messageId: string }>(req, 'params');
  const r = await svc.deleteMessage(currentUser(req), p.id, p.messageId);
  await audit(req, { action: 'support.message.delete', entityType: 'TicketMessage', entityId: p.messageId });
  return ok(res, r);
});

/** Read receipts are UI state (no confirmation, no idempotency key). */
ticketRouter.post('/:id/read', validate({ params: idParams }), async (req: Request, res: Response) => ok(res, await svc.markRead(currentUser(req), tid(req))));

/** Attachment download for people who can see the ticket (internal-note files: staff only). */
ticketRouter.get('/:id/attachments/:sha', validate({ params: z.object({ id: objectId, sha: z.string().regex(/^[a-f0-9]{64}$/) }) }), async (req: Request, res: Response) => {
  const user = currentUser(req);
  const { id, sha } = input<{ id: string; sha: string }>(req, 'params');
  const t = await svc.loadTicket(user, id);
  let att = t.attachments.find((a) => a.sha256 === sha);
  if (!att) {
    const m = await TicketMessage.findOne({ ticketId: t._id, deletedAt: null, 'attachments.sha256': sha, ...(isStaff(user) ? {} : { internal: false }) }).lean();
    att = m?.attachments.find((a) => a.sha256 === sha);
  }
  if (!att) throw notFound('Attachment not found.');
  const data = await getObjectBuffer(att.key);
  res.setHeader('Content-Type', att.mimeType);
  res.setHeader('Content-Length', String(data.length));
  res.setHeader('Content-Disposition', `attachment; filename="${att.name.replace(/[^\w.\- ]/g, '_')}"`);
  res.setHeader('X-Content-SHA256', sha);
  res.end(data);
});

// -------------------------------------------------------------------------- support (staff tools)
export const supportRouter = Router();
supportRouter.use(requireAuth);

/** Whether a human is around right now (citizens see "agents online" in chat). */
supportRouter.get('/presence', async (_req: Request, res: Response) => ok(res, { agentsOnline: await agentsOnline() }));

supportRouter.get('/agents', requireRole(...STAFF), async (_req: Request, res: Response) => {
  const agents = await User.find({ role: { $in: [...STAFF] }, status: 'ACTIVE' }, { _id: 0, userId: 1, fullName: 1, role: 1 }).sort({ fullName: 1 }).lean();
  return ok(res, agents);
});

const cannedBody = z.object({ title: z.string().trim().min(2).max(80), body: z.string().trim().min(2).max(4000), tags: z.array(z.string().trim().toLowerCase().max(30)).max(10).default([]) });

supportRouter.get('/canned', requireRole(...STAFF), validate({ query: z.object({ q: z.string().trim().max(80).optional() }) }), async (req: Request, res: Response) => {
  const q = input<{ q?: string }>(req, 'query').q;
  const rx = q ? new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') : null;
  const items = await CannedResponse.find({ deletedAt: null, ...(rx ? { $or: [{ title: rx }, { body: rx }, { tags: rx }] } : {}) }).sort({ title: 1 }).lean();
  return ok(res, items);
});

supportRouter.post('/canned', requireRole(...STAFF), idempotent, validate({ body: cannedBody }), async (req: Request, res: Response) => {
  const c = await CannedResponse.create({ ...input<z.infer<typeof cannedBody>>(req, 'body'), createdBy: currentUser(req).userId });
  await audit(req, { action: 'support.canned.create', entityType: 'CannedResponse', entityId: String(c._id) });
  return created(res, c.toObject());
});

supportRouter.patch('/canned/:id', requireRole(...STAFF), idempotent, validate({ params: idParams, body: cannedBody.partial() }), async (req: Request, res: Response) => {
  const c = await CannedResponse.findOneAndUpdate({ _id: tid(req), deletedAt: null }, { $set: input(req, 'body') }, { returnDocument: 'after' }).lean();
  if (!c) throw notFound('Canned response not found.');
  await audit(req, { action: 'support.canned.update', entityType: 'CannedResponse', entityId: tid(req) });
  return ok(res, c);
});

supportRouter.delete('/canned/:id', requireRole(...STAFF), idempotent, validate({ params: idParams }), async (req: Request, res: Response) => {
  const c = await CannedResponse.findOneAndUpdate({ _id: tid(req), deletedAt: null }, { deletedAt: new Date() }).lean();
  if (!c) throw notFound('Canned response not found.');
  await audit(req, { action: 'support.canned.delete', entityType: 'CannedResponse', entityId: tid(req) });
  return ok(res, { deleted: true });
});

// Escalations: support raises them, land officers answer them.
supportRouter.get('/escalations', requireRole('LAND_OFFICER', 'REGISTRAR', ...STAFF), validate({ query: z.object({ status: z.enum(['OPEN', 'DONE', 'ALL']).default('OPEN') }) }), async (req: Request, res: Response) =>
  ok(res, await svc.listEscalations(input<{ status: 'OPEN' | 'DONE' | 'ALL' }>(req, 'query').status)),
);

supportRouter.post('/escalations/:id/done', requireRole('LAND_OFFICER', 'REGISTRAR'), idempotent, validate({ params: idParams, body: z.object({ resolution: z.string().trim().min(5).max(2000) }) }), async (req: Request, res: Response) => {
  const e = await svc.completeEscalation(currentUser(req), tid(req), input<{ resolution: string }>(req, 'body').resolution);
  await audit(req, { action: 'support.escalation.done', entityType: 'Escalation', entityId: tid(req), meta: { ticketNumber: e.ticketNumber } });
  return ok(res, { ...e, id: String(e._id) });
});

/** Admin metrics (§11): open tickets, average first response / resolution, CSAT trend, tickets by category. */
supportRouter.get('/metrics', requireRole(...STAFF), validate({ query: z.object({ days: z.coerce.number().int().min(7).max(365).default(30) }) }), async (req: Request, res: Response) => {
  const days = input<{ days: number }>(req, 'query').days;
  const since = new Date(Date.now() - days * 86_400_000);
  const live = { deletedAt: null };
  const [open, byStatus, byCategory, firstResp, resolution, csat, breached] = await Promise.all([
    Ticket.countDocuments({ ...live, status: { $in: ['OPEN', 'IN_PROGRESS', 'AWAITING_USER'] } }),
    Ticket.aggregate<{ _id: string; n: number }>([{ $match: live }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
    Ticket.aggregate<{ _id: string; n: number }>([{ $match: { ...live, createdAt: { $gte: since } } }, { $group: { _id: '$category', n: { $sum: 1 } } }, { $sort: { n: -1 } }]),
    Ticket.aggregate<{ avg: number; n: number }>([
      { $match: { ...live, createdAt: { $gte: since }, firstResponseAt: { $ne: null } } },
      { $group: { _id: null, avg: { $avg: { $subtract: ['$firstResponseAt', '$createdAt'] } }, n: { $sum: 1 } } },
    ]),
    Ticket.aggregate<{ avg: number; n: number }>([
      { $match: { ...live, createdAt: { $gte: since }, resolvedAt: { $ne: null } } },
      { $group: { _id: null, avg: { $avg: { $subtract: ['$resolvedAt', '$createdAt'] } }, n: { $sum: 1 } } },
    ]),
    Ticket.aggregate<{ _id: string; avg: number; n: number }>([
      { $match: { ...live, 'rating.at': { $gte: since } } },
      { $group: { _id: { $dateToString: { format: '%G-W%V', date: '$rating.at' } }, avg: { $avg: '$rating.stars' }, n: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
    Ticket.countDocuments({ ...live, status: { $in: ['OPEN', 'IN_PROGRESS', 'AWAITING_USER'] }, $or: [{ firstResponseAt: null, firstResponseDueAt: { $lt: new Date() } }, { resolveDueAt: { $lt: new Date() } }] }),
  ]);
  const rated = csat.reduce((a, w) => a + w.n, 0);
  return ok(res, {
    days,
    openTickets: open,
    slaBreached: breached,
    byStatus: Object.fromEntries(byStatus.map((s) => [s._id, s.n])),
    byCategory: byCategory.map((c) => ({ category: c._id, count: c.n })),
    avgFirstResponseMinutes: firstResp[0] ? Math.round(firstResp[0].avg / 60_000) : null,
    avgResolutionHours: resolution[0] ? Math.round((resolution[0].avg / 3_600_000) * 10) / 10 : null,
    csat: { average: rated ? Math.round((csat.reduce((a, w) => a + w.avg * w.n, 0) / rated) * 100) / 100 : null, ratings: rated, trend: csat.map((w) => ({ week: w._id, average: Math.round(w.avg * 100) / 100, ratings: w.n })) },
    agentsOnline: await agentsOnline(),
  });
});
