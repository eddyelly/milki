import { type Types } from 'mongoose';
import type { AuthUser } from '../../core/auth';
import { AppError, badRequest, conflict, forbidden, notFound } from '../../core/errors';
import { logger } from '../../core/logger';
import { notify } from '../../core/notify';
import { emitToRole } from '../../core/socket';
import { putObject } from '../../core/storage';
import { sha256Hex } from '../../core/crypto';
import { sniff, type UploadedFile } from '../documents/document.service';
import { enqueueNotification } from '../notifications/notification.service';
import { ParcelCache } from '../parcels/parcel-cache.model';
import { TransferCache } from '../transfers/transfer-cache.model';
import { User } from '../users/user.model';
import { displayName } from '../users/user.service';
import { dueDates, slaView } from './sla';
import { emitTicket, emitToStaff, emitToSupportUser, isStaff, isWatching } from './support.socket';
import { Escalation, nextTicketNumber, Ticket, type TICKET_CATEGORIES, type TicketAttrs, TicketMessage, type TicketPriority, type TicketStatus } from './support.models';

export const EDIT_WINDOW_MS = 5 * 60 * 1000;
export const REOPEN_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

type TicketDoc = InstanceType<typeof Ticket>;

/** Allowed agent transitions (CLAUDE.md §11: OPEN → IN_PROGRESS → AWAITING_USER → RESOLVED → CLOSED). */
const AGENT_TRANSITIONS: Readonly<Record<TicketStatus, readonly TicketStatus[]>> = {
  OPEN: ['IN_PROGRESS', 'AWAITING_USER', 'RESOLVED', 'CLOSED'],
  IN_PROGRESS: ['AWAITING_USER', 'RESOLVED', 'CLOSED'],
  AWAITING_USER: ['IN_PROGRESS', 'RESOLVED', 'CLOSED'],
  RESOLVED: ['IN_PROGRESS', 'CLOSED'],
  CLOSED: [],
};

const L = {
  reply: { en: 'Support replied', sw: 'Huduma kwa wateja wamejibu' },
  resolved: { en: 'Your ticket was resolved', sw: 'Tiketi yako imetatuliwa' },
  escalated: { en: 'New escalation from support', sw: 'Suala jipya kutoka huduma kwa wateja' },
  escalationDone: { en: 'Land office answered an escalation', sw: 'Ofisi ya ardhi imejibu suala' },
};

// ------------------------------------------------------------------------------------------ views
type TicketPlain = TicketAttrs & { _id: Types.ObjectId; createdAt: Date; updatedAt: Date };

export function ticketView(t: TicketDoc | Record<string, unknown>, now = new Date()) {
  const o = ('toObject' in t && typeof t.toObject === 'function' ? t.toObject() : t) as TicketPlain;
  const resolvedAt = o.resolvedAt ? new Date(o.resolvedAt) : null;
  return {
    ...o,
    id: String(o._id),
    sla: slaView(o, now),
    canReopenUntil: resolvedAt ? new Date(resolvedAt.getTime() + REOPEN_WINDOW_MS) : null,
  };
}

async function names(userIds: (string | null | undefined)[]): Promise<Map<string, { name: string; role: string }>> {
  const ids = [...new Set(userIds.filter((x): x is string => !!x))];
  const users = await User.find({ userId: { $in: ids } }, { userId: 1, fullName: 1, role: 1 }).lean();
  return new Map(users.map((u) => [u.userId, { name: u.role === 'CITIZEN' ? displayName(u.fullName) : u.fullName, role: u.role }]));
}

export async function loadTicket(user: AuthUser, id: string): Promise<TicketDoc> {
  const t = await Ticket.findOne({ _id: id, deletedAt: null });
  if (!t || (!isStaff(user) && t.userId !== user.userId)) throw notFound('Ticket not found.', 'TICKET_NOT_FOUND');
  return t;
}

// ------------------------------------------------------------------------------------- attachments
export async function storeAttachment(ticketNumber: string, file: UploadedFile) {
  if (file.size > MAX_ATTACHMENT_BYTES) throw new AppError(413, 'FILE_TOO_LARGE', 'Attachments can be at most 10 MB.');
  const sig = sniff(file);
  const sha = sha256Hex(file.buffer);
  const key = `tickets/${ticketNumber}/${sha}.${sig.ext}`;
  await putObject(key, file.buffer, sig.mime, { ticket: ticketNumber });
  return { key, name: file.originalname.slice(0, 120), mimeType: sig.mime, size: file.size, sha256: sha };
}

// ------------------------------------------------------------------------------------------- create
export interface CreateTicketInput {
  category: (typeof TICKET_CATEGORIES)[number];
  priority: TicketPriority;
  subject: string;
  description: string;
  parcelId?: string | null;
  transferId?: string | null;
}

export async function createTicket(user: AuthUser, input: CreateTicketInput, file?: UploadedFile) {
  // Context links must belong to the requester (citizens), agents see them read-only later.
  if (input.parcelId && user.role === 'CITIZEN' && !(await ParcelCache.exists({ parcelId: input.parcelId, ownerId: user.userId }))) {
    throw forbidden('You can only attach your own parcels to a ticket.');
  }
  if (input.transferId && user.role === 'CITIZEN' && !(await TransferCache.exists({ transferId: input.transferId, $or: [{ sellerId: user.userId }, { buyerId: user.userId }] }))) {
    throw forbidden('You can only attach your own transfers to a ticket.');
  }
  const number = await nextTicketNumber();
  const now = new Date();
  const attachments = file ? [await storeAttachment(number, file)] : [];
  const t = await Ticket.create({ ...input, number, userId: user.userId, attachments, ...dueDates(input.priority, now), lastMessageAt: now });
  const view = ticketView(t);
  emitToStaff('queue:updated', { ticketId: view.id, number, kind: 'created' });
  emitToRole('SUPPORT_AGENT', 'queue:updated', { kind: 'ticket', ticketId: view.id });
  return view;
}

// --------------------------------------------------------------------------------------------- list
export interface ListQuery {
  page: number;
  limit: number;
  q?: string;
  status?: string;
  priority?: string;
  category?: string;
  assignee?: string;
  tag?: string;
  sort: string;
}

export async function listTickets(user: AuthUser, q: ListQuery) {
  const filter: Record<string, unknown> = { deletedAt: null };
  if (!isStaff(user)) filter.userId = user.userId;
  if (q.status) filter.status = { $in: q.status.split(',') };
  if (q.priority) filter.priority = { $in: q.priority.split(',') };
  if (q.category) filter.category = q.category;
  if (q.tag) filter.tags = q.tag;
  if (isStaff(user) && q.assignee) filter.assigneeId = q.assignee === 'me' ? user.userId : q.assignee === 'unassigned' ? null : q.assignee;
  if (q.q) {
    const rx = new RegExp(q.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ number: rx }, { subject: rx }, { parcelId: rx }, { transferId: rx }];
  }
  // "sla" sorts by the clock that runs out first; priority sorts URGENT first.
  const sorts: Record<string, Record<string, 1 | -1>> = {
    '-updatedAt': { updatedAt: -1 },
    updatedAt: { updatedAt: 1 },
    '-createdAt': { createdAt: -1 },
    createdAt: { createdAt: 1 },
    sla: { firstResponseAt: 1, firstResponseDueAt: 1, resolveDueAt: 1 },
    '-lastMessageAt': { lastMessageAt: -1 },
  };
  let items: TicketDoc[];
  const total = await Ticket.countDocuments(filter);
  if (q.sort === 'priority') {
    const order = { URGENT: 0, HIGH: 1, NORMAL: 2, LOW: 3 };
    const all = await Ticket.find(filter).sort({ createdAt: 1 }).limit(1000);
    items = all.sort((a, b) => order[a.priority] - order[b.priority]).slice((q.page - 1) * q.limit, q.page * q.limit);
  } else {
    items = await Ticket.find(filter).sort(sorts[q.sort] ?? { updatedAt: -1 }).skip((q.page - 1) * q.limit).limit(q.limit);
  }
  const who = await names(items.flatMap((t) => [t.userId, t.assigneeId]));
  const now = new Date();
  return {
    items: items.map((t) => ({ ...ticketView(t, now), requester: who.get(t.userId)?.name ?? null, assignee: t.assigneeId ? (who.get(t.assigneeId)?.name ?? null) : null })),
    total,
  };
}

// --------------------------------------------------------------------------------------------- read
export async function getTicket(user: AuthUser, id: string) {
  const t = await loadTicket(user, id);
  const who = await names([t.userId, t.assigneeId]);
  return { ...ticketView(t), requester: who.get(t.userId)?.name ?? null, assignee: t.assigneeId ? (who.get(t.assigneeId)?.name ?? null) : null };
}

function messageView(m: InstanceType<typeof TicketMessage> | Record<string, unknown>, who: Map<string, { name: string; role: string }>) {
  const o = ('toObject' in m && typeof m.toObject === 'function' ? m.toObject() : m) as Record<string, unknown> & { authorId: string; deletedAt: Date | null; body: string };
  return { ...o, id: String(o._id), author: who.get(o.authorId)?.name ?? null, body: o.deletedAt ? '' : o.body, attachments: o.deletedAt ? [] : o.attachments };
}

export async function listMessages(user: AuthUser, id: string) {
  const t = await loadTicket(user, id);
  const msgs = await TicketMessage.find({ ticketId: t._id, ...(isStaff(user) ? {} : { internal: false }) }).sort({ createdAt: 1 }).limit(1000).lean();
  const who = await names(msgs.map((m) => m.authorId));
  return msgs.map((m) => messageView(m, who));
}

// ----------------------------------------------------------------------------------------- messages
export async function postMessage(user: AuthUser, id: string, input: { body: string; internal: boolean }, file?: UploadedFile) {
  const t = await loadTicket(user, id);
  const staff = isStaff(user);
  if (input.internal && !staff) throw forbidden('Only support staff can add internal notes.');
  if (t.status === 'CLOSED') throw conflict('This ticket is closed. Reopen it or create a new one.', null, 'TICKET_CLOSED');
  if (!input.body.trim() && !file) throw badRequest('Write a message or attach a file.');

  const attachments = file ? [await storeAttachment(t.number, file)] : [];
  const now = new Date();
  const m = await TicketMessage.create({ ticketId: t._id, authorId: user.userId, authorRole: user.role, body: input.body.trim(), internal: input.internal, attachments, readBy: [{ userId: user.userId, at: now }] });

  if (!input.internal) {
    t.lastMessageAt = now;
    if (staff) {
      t.firstResponseAt ??= now;
      if (t.status === 'OPEN') t.status = 'IN_PROGRESS';
      t.assigneeId ??= user.userId;
    } else if (t.status === 'AWAITING_USER' || t.status === 'RESOLVED') {
      // The user answering moves the ticket back to the agent (a resolved ticket reopens only via /reopen).
      if (t.status === 'AWAITING_USER') t.status = 'IN_PROGRESS';
    }
    await t.save();
  }

  const who = await names([user.userId]);
  const view = messageView(m, who);
  emitTicket(String(t._id), 'message:new', view, input.internal);
  emitTicket(String(t._id), 'ticket:updated', ticketView(t));
  if (!input.internal) emitToStaff('queue:updated', { ticketId: String(t._id), number: t.number, kind: 'message' });

  // No live chat? Replies become push + email (CLAUDE.md §11).
  if (staff && !input.internal && !(await isWatching(t.userId, String(t._id)))) {
    void notifyRequester(t, input.body.trim(), 'reply');
  }
  return view;
}

async function notifyRequester(t: TicketDoc, text: string, kind: 'reply' | 'resolved'): Promise<void> {
  try {
    const title = kind === 'reply' ? L.reply : L.resolved;
    const snippet = text.length > 140 ? `${text.slice(0, 137)}…` : text;
    await enqueueNotification({
      userIds: [t.userId],
      type: kind === 'reply' ? 'support.reply' : 'support.resolved',
      title: { en: `${title.en} · ${t.number}`, sw: `${title.sw} · ${t.number}` },
      body: kind === 'reply' ? { en: snippet, sw: snippet } : { en: 'Tell us how we did: rate this ticket in the app.', sw: 'Tuambie tulivyofanya: kadiria tiketi hii kwenye programu.' },
      data: { ticketId: String(t._id), ticketNumber: t.number },
    });
    const u = await User.findOne({ userId: t.userId }, { email: 1, preferredLanguage: 1 }).lean();
    if (u?.email) {
      const sw = u.preferredLanguage === 'sw';
      await notify.email(u.email, `${(sw ? title.sw : title.en)} · ${t.number}`, `${kind === 'reply' ? snippet : sw ? 'Tiketi yako imetatuliwa.' : 'Your ticket was resolved.'}\n\n${t.subject}\n\nMilki`);
    }
  } catch (err) {
    logger.warn({ err: (err as Error).message, ticket: t.number }, 'support notification failed');
  }
}

async function ownMessage(user: AuthUser, ticketId: string, messageId: string) {
  const t = await loadTicket(user, ticketId);
  const m = await TicketMessage.findOne({ _id: messageId, ticketId: t._id, deletedAt: null });
  if (!m) throw notFound('Message not found.');
  if (m.authorId !== user.userId) throw forbidden('You can only change your own messages.');
  if (Date.now() - m.createdAt.getTime() > EDIT_WINDOW_MS) throw conflict('Messages can only be changed for 5 minutes after sending.', null, 'EDIT_WINDOW_PASSED');
  return { t, m };
}

export async function editMessage(user: AuthUser, ticketId: string, messageId: string, body: string) {
  const { t, m } = await ownMessage(user, ticketId, messageId);
  m.body = body.trim();
  m.editedAt = new Date();
  await m.save();
  const view = messageView(m, await names([user.userId]));
  emitTicket(String(t._id), 'message:updated', view, m.internal);
  return view;
}

export async function deleteMessage(user: AuthUser, ticketId: string, messageId: string) {
  const { t, m } = await ownMessage(user, ticketId, messageId);
  m.deletedAt = new Date();
  await m.save();
  emitTicket(String(t._id), 'message:deleted', { id: String(m._id), ticketId: String(t._id) }, m.internal);
  return { deleted: true };
}

/** Read receipts: marks everyone else's visible messages as read by this user. */
export async function markRead(user: AuthUser, ticketId: string) {
  const t = await loadTicket(user, ticketId);
  const at = new Date();
  const r = await TicketMessage.updateMany(
    { ticketId: t._id, authorId: { $ne: user.userId }, 'readBy.userId': { $ne: user.userId }, ...(isStaff(user) ? {} : { internal: false }) },
    { $push: { readBy: { userId: user.userId, at } } },
  );
  if (r.modifiedCount > 0) emitTicket(String(t._id), 'read', { ticketId: String(t._id), userId: user.userId, role: user.role, at });
  return { updated: r.modifiedCount };
}

// ------------------------------------------------------------------------------------ agent updates
export interface UpdateInput {
  status?: TicketStatus;
  priority?: TicketPriority;
  assigneeId?: string | null;
  tags?: string[];
}

function applyStatus(t: TicketDoc, to: TicketStatus) {
  if (to === t.status) return;
  if (!AGENT_TRANSITIONS[t.status].includes(to)) throw new AppError(409, 'INVALID_STATE', `A ${t.status.replace('_', ' ').toLowerCase()} ticket cannot move to ${to.replace('_', ' ').toLowerCase()}.`);
  const now = new Date();
  if (to === 'RESOLVED') t.resolvedAt = now;
  if (to === 'CLOSED') {
    t.closedAt = now;
    t.resolvedAt ??= now;
  }
  if (to === 'IN_PROGRESS' && t.status === 'RESOLVED') t.resolvedAt = null;
  t.status = to;
}

export async function updateTicket(user: AuthUser, id: string, input: UpdateInput) {
  const t = await loadTicket(user, id);
  const before = { status: t.status, priority: t.priority, assigneeId: t.assigneeId };
  if (input.assigneeId !== undefined && input.assigneeId !== null) {
    const agent = await User.findOne({ userId: input.assigneeId, role: { $in: ['SUPPORT_AGENT', 'SYSTEM_ADMIN'] }, status: 'ACTIVE' }).lean();
    if (!agent) throw badRequest('Tickets can only be assigned to an active support agent.', null, 'INVALID_ASSIGNEE');
  }
  if (input.assigneeId !== undefined) t.assigneeId = input.assigneeId;
  if (input.tags) t.tags = [...new Set(input.tags)];
  if (input.priority && input.priority !== t.priority) {
    t.priority = input.priority;
    Object.assign(t, dueDates(input.priority, t.createdAt));
  }
  if (input.status) applyStatus(t, input.status);
  await t.save();
  const view = await getTicket(user, id);
  emitTicket(id, 'ticket:updated', view);
  emitToStaff('queue:updated', { ticketId: id, number: t.number, kind: 'updated' });
  if (before.status !== 'RESOLVED' && t.status === 'RESOLVED') void notifyRequester(t, '', 'resolved');
  if (input.assigneeId && input.assigneeId !== before.assigneeId) emitToSupportUser(input.assigneeId, 'ticket:assigned', { ticketId: id, number: t.number });
  return { view, before };
}

export async function claimTicket(user: AuthUser, id: string) {
  const t = await loadTicket(user, id);
  if (t.assigneeId && t.assigneeId !== user.userId) throw conflict('Another agent already has this ticket. Ask them, or reassign it.', null, 'ALREADY_ASSIGNED');
  return updateTicket(user, id, { assigneeId: user.userId, ...(t.status === 'OPEN' ? { status: 'IN_PROGRESS' as const } : {}) });
}

/** The requester or staff can close (T2 in the UI). */
export async function closeTicket(user: AuthUser, id: string) {
  const t = await loadTicket(user, id);
  if (t.status === 'CLOSED') return ticketView(t);
  const now = new Date();
  t.status = 'CLOSED';
  t.closedAt = now;
  t.resolvedAt ??= now;
  await t.save();
  emitTicket(id, 'ticket:updated', ticketView(t));
  emitToStaff('queue:updated', { ticketId: id, number: t.number, kind: 'closed' });
  return ticketView(t);
}

/** Requester reopens within 7 days of resolution (§11). */
export async function reopenTicket(user: AuthUser, id: string) {
  const t = await loadTicket(user, id);
  if (t.userId !== user.userId) throw forbidden('Only the person who opened the ticket can reopen it.');
  if (t.status !== 'RESOLVED' && t.status !== 'CLOSED') throw conflict('This ticket is still open.', null, 'INVALID_STATE');
  if (!t.resolvedAt || Date.now() - t.resolvedAt.getTime() > REOPEN_WINDOW_MS) {
    throw conflict('Tickets can be reopened for 7 days after they are resolved. Please open a new ticket.', null, 'REOPEN_WINDOW_PASSED');
  }
  t.status = t.assigneeId ? 'IN_PROGRESS' : 'OPEN';
  t.resolvedAt = null;
  t.closedAt = null;
  t.rating = null;
  // A fresh resolution clock from now, keeping the original priority.
  t.resolveDueAt = dueDates(t.priority, new Date()).resolveDueAt;
  await t.save();
  emitTicket(id, 'ticket:updated', ticketView(t));
  emitToStaff('queue:updated', { ticketId: id, number: t.number, kind: 'reopened' });
  return ticketView(t);
}

/** CSAT: 1–5 stars plus a comment, once the ticket is resolved. */
export async function rateTicket(user: AuthUser, id: string, input: { stars: number; comment?: string }) {
  const t = await loadTicket(user, id);
  if (t.userId !== user.userId) throw forbidden('Only the person who opened the ticket can rate it.');
  if (t.status !== 'RESOLVED' && t.status !== 'CLOSED') throw conflict('You can rate a ticket once it is resolved.', null, 'INVALID_STATE');
  t.rating = { stars: input.stars, comment: input.comment?.trim() ?? '', at: new Date() };
  await t.save();
  emitTicket(id, 'ticket:updated', ticketView(t));
  return ticketView(t);
}

export async function softDeleteTicket(user: AuthUser, id: string) {
  const t = await loadTicket(user, id);
  t.deletedAt = new Date();
  await t.save();
  emitToStaff('queue:updated', { ticketId: id, number: t.number, kind: 'deleted' });
  return { deleted: true, number: t.number };
}

// --------------------------------------------------------------------------- read-only agent context
/** Agents see the requester's parcels and transfers, read-only, from the cache (never the ledger writes). */
export async function ticketContext(user: AuthUser, id: string) {
  const t = await loadTicket(user, id);
  const u = await User.findOne({ userId: t.userId }, { userId: 1, fullName: 1, phone: 1, email: 1, role: 1, preferredLanguage: 1, createdAt: 1 }).lean();
  const [parcels, transfers, previous] = await Promise.all([
    ParcelCache.find({ ownerId: t.userId }, { _id: 0, parcelId: 1, titleNumber: 1, region: 1, district: 1, ward: 1, area: 1, landUse: 1, status: 1, activeTransferId: 1, ledgerUpdatedAt: 1, lastTxId: 1 }).sort({ ledgerUpdatedAt: -1 }).limit(50).lean(),
    TransferCache.find({ $or: [{ sellerId: t.userId }, { buyerId: t.userId }] }, { _id: 0, transferId: 1, parcelId: 1, sellerId: 1, buyerId: 1, status: 1, ledgerUpdatedAt: 1, lastTxId: 1 }).sort({ ledgerUpdatedAt: -1 }).limit(50).lean(),
    Ticket.find({ userId: t.userId, _id: { $ne: t._id }, deletedAt: null }, { number: 1, subject: 1, status: 1, createdAt: 1 }).sort({ createdAt: -1 }).limit(10).lean(),
  ]);
  return {
    user: u ? { userId: u.userId, fullName: u.fullName, phone: u.phone, email: u.email ?? null, role: u.role, preferredLanguage: u.preferredLanguage, memberSince: u.createdAt } : null,
    linked: { parcelId: t.parcelId, transferId: t.transferId },
    parcels,
    transfers: transfers.map((x) => ({ ...x, side: x.sellerId === t.userId ? 'SELLER' : 'BUYER' })),
    previousTickets: previous,
  };
}

// ------------------------------------------------------------------------------------ escalations
export async function escalate(user: AuthUser, id: string, note: string) {
  const t = await loadTicket(user, id);
  if (await Escalation.exists({ ticketId: t._id, status: 'OPEN' })) throw conflict('This ticket already has an open escalation.', null, 'ALREADY_ESCALATED');
  const e = await Escalation.create({ ticketId: t._id, ticketNumber: t.number, note: note.trim(), parcelId: t.parcelId, transferId: t.transferId, createdBy: user.userId });
  await postMessage(user, id, { body: `Escalated to a land officer: ${note.trim()}`, internal: true });
  const officers = await User.find({ role: 'LAND_OFFICER', status: 'ACTIVE' }, { userId: 1 }).lean();
  emitToRole('LAND_OFFICER', 'queue:updated', { kind: 'escalation', escalationId: String(e._id) });
  await enqueueNotification({
    userIds: officers.map((o) => o.userId),
    type: 'support.escalation',
    title: L.escalated,
    body: { en: `${t.number}: ${t.subject}`, sw: `${t.number}: ${t.subject}` },
    data: { escalationId: String(e._id), ticketNumber: t.number, parcelId: t.parcelId ?? null, transferId: t.transferId ?? null },
  });
  return e.toObject();
}

export async function listEscalations(status: 'OPEN' | 'DONE' | 'ALL') {
  const items = await Escalation.find(status === 'ALL' ? {} : { status }).sort({ createdAt: -1 }).limit(200).lean();
  const who = await names(items.flatMap((e) => [e.createdBy, e.doneBy]));
  const tickets = await Ticket.find({ _id: { $in: items.map((e) => e.ticketId) } }, { subject: 1, category: 1, priority: 1 }).lean();
  const byId = new Map(tickets.map((x) => [String(x._id), x]));
  return items.map((e) => ({
    ...e,
    id: String(e._id),
    createdByName: who.get(e.createdBy)?.name ?? null,
    doneByName: e.doneBy ? (who.get(e.doneBy)?.name ?? null) : null,
    subject: byId.get(String(e.ticketId))?.subject ?? null,
    priority: byId.get(String(e.ticketId))?.priority ?? null,
  }));
}

export async function completeEscalation(user: AuthUser, escalationId: Types.ObjectId | string, resolution: string) {
  const e = await Escalation.findById(escalationId);
  if (!e) throw notFound('Escalation not found.');
  if (e.status === 'DONE') throw conflict('This escalation is already answered.', null, 'ALREADY_DONE');
  e.status = 'DONE';
  e.doneBy = user.userId;
  e.doneAt = new Date();
  e.resolution = resolution.trim();
  await e.save();
  const t = await Ticket.findById(e.ticketId);
  if (t) {
    const officer = (await names([user.userId])).get(user.userId)?.name ?? 'Land officer';
    const m = await TicketMessage.create({ ticketId: t._id, authorId: user.userId, authorRole: user.role, body: `Land office (${officer}): ${resolution.trim()}`, internal: true, readBy: [{ userId: user.userId, at: new Date() }] });
    emitTicket(String(t._id), 'message:new', messageView(m, await names([user.userId])), true);
    emitToStaff('queue:updated', { ticketId: String(t._id), number: t.number, kind: 'escalation-done' });
    if (t.assigneeId) {
      await enqueueNotification({ userIds: [t.assigneeId], type: 'support.escalationDone', title: L.escalationDone, body: { en: t.number, sw: t.number }, data: { ticketId: String(t._id), ticketNumber: t.number } });
    }
  }
  return e.toObject();
}
