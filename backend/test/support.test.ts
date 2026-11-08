import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { io as connect, type Socket } from 'socket.io-client';
import { Types } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { attachSocket, closeSocket, onSocketAttached } from '../src/core/socket';
import { AuditLog } from '../src/modules/audit/audit.model';
import { KbArticle, KbCategory } from '../src/modules/kb/kb.models';
import { Notification } from '../src/modules/notifications/notification.model';
import { ParcelCache } from '../src/modules/parcels/parcel-cache.model';
import { slaView } from '../src/modules/support/sla';
import { attachSupportNamespace } from '../src/modules/support/support.socket';
import { Escalation, Ticket } from '../src/modules/support/support.models';
import { api, idemKey, makeUser } from './helpers';
import { objects, outbox } from './outbox';

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const PDF = Buffer.from('%PDF-1.7\nreceipt\n%%EOF');

async function newTicket(token: string, body: Record<string, unknown> = {}) {
  const res = await api()
    .post('/api/v1/tickets')
    .set(bearer(token))
    .set('Idempotency-Key', idemKey())
    .send({ category: 'TRANSFERS', subject: 'Transfer stuck', description: 'My buyer cannot see the transfer.', ...body });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data as { id: string; number: string; status: string; sla: { state: string; target: string } };
}

const say = (token: string, ticketId: string, body: string, internal = false) =>
  api().post(`/api/v1/tickets/${ticketId}/messages`).set(bearer(token)).set('Idempotency-Key', idemKey()).send({ body, internal });

describe('help centre (KB)', () => {
  it('readers see only published articles; editors manage drafts; votes are one per reader', async () => {
    const agent = await makeUser('SUPPORT_AGENT');
    const citizen = await makeUser('CITIZEN');
    await KbCategory.create({ slug: 'transfers', name: { en: 'Transfers', sw: 'Uhamisho' } });

    const draft = { slug: 'how-to-transfer', categorySlug: 'transfers', title: { en: 'How to transfer', sw: 'Jinsi ya kuhamisha' }, body: { en: 'Open the parcel.', sw: 'Fungua kiwanja.' } };
    await api().post('/api/v1/kb/articles').set(bearer(citizen.token)).set('Idempotency-Key', idemKey()).send(draft).expect(403);
    const created = await api().post('/api/v1/kb/articles').set(bearer(agent.token)).set('Idempotency-Key', idemKey()).send(draft);
    expect(created.status).toBe(201);
    expect(created.body.data.status).toBe('DRAFT');

    expect((await api().get('/api/v1/kb/articles')).body.data).toHaveLength(0);
    await api().get('/api/v1/kb/articles/how-to-transfer').expect(404);
    expect((await api().get('/api/v1/kb/articles?status=ALL').set(bearer(agent.token))).body.data).toHaveLength(1);

    await api().patch(`/api/v1/kb/articles/${created.body.data._id}`).set(bearer(agent.token)).set('Idempotency-Key', idemKey()).send({ status: 'PUBLISHED' }).expect(200);
    const list = await api().get('/api/v1/kb/articles?q=parcel');
    expect(list.body.data.map((a: { slug: string }) => a.slug)).toEqual(['how-to-transfer']);
    const cats = await api().get('/api/v1/kb/categories');
    expect(cats.body.data[0]).toMatchObject({ slug: 'transfers', articleCount: 1 });
    expect((await api().get('/api/v1/kb/articles/how-to-transfer')).body.data.views).toBe(1);

    const v1 = await api().post('/api/v1/kb/articles/how-to-transfer/vote').set(bearer(citizen.token)).send({ helpful: true });
    expect(v1.body.data).toMatchObject({ helpfulYes: 1, helpfulNo: 0 });
    await api().post('/api/v1/kb/articles/how-to-transfer/vote').set(bearer(citizen.token)).send({ helpful: true });
    const v3 = await api().post('/api/v1/kb/articles/how-to-transfer/vote').set(bearer(citizen.token)).send({ helpful: false });
    expect(v3.body.data).toMatchObject({ helpfulYes: 0, helpfulNo: 1 });

    await api().delete(`/api/v1/kb/articles/${created.body.data._id}`).set(bearer(agent.token)).set('Idempotency-Key', idemKey()).expect(200);
    expect(await KbArticle.findOne({ slug: 'how-to-transfer' }).lean()).toMatchObject({ status: 'DRAFT' });
    expect((await KbArticle.findOne({ slug: 'how-to-transfer' }).lean())?.deletedAt).toBeTruthy();
    expect(await AuditLog.countDocuments({ action: /^kb\.article\./ })).toBe(3);
  });

  it('a category with articles cannot be deleted', async () => {
    const admin = await makeUser('SYSTEM_ADMIN');
    const c = await KbCategory.create({ slug: 'account', name: { en: 'Account', sw: 'Akaunti' } });
    await KbArticle.create({ slug: 'x', categorySlug: 'account', title: { en: 'x', sw: 'x' }, body: { en: 'x', sw: 'x' }, createdBy: 'usr_x' });
    const res = await api().delete(`/api/v1/kb/categories/${c._id}`).set(bearer(admin.token)).set('Idempotency-Key', idemKey());
    expect(res.body.error.code).toBe('CATEGORY_NOT_EMPTY');
  });
});

describe('tickets', () => {
  it('numbers tickets MLK-000001…, sets the SLA and keeps them private to the requester', async () => {
    const a = await makeUser('CITIZEN');
    const b = await makeUser('CITIZEN');
    const t1 = await newTicket(a.token, { priority: 'URGENT' });
    const t2 = await newTicket(b.token);
    expect(t1.number).toBe('MLK-000001');
    expect(t2.number).toBe('MLK-000002');
    expect(t1.sla).toMatchObject({ target: 'FIRST_RESPONSE', state: 'OK' });
    await api().get(`/api/v1/tickets/${t1.id}`).set(bearer(b.token)).expect(404);
    const mine = await api().get('/api/v1/tickets').set(bearer(b.token));
    expect(mine.body.data.map((t: { number: string }) => t.number)).toEqual(['MLK-000002']);
  });

  it('a citizen can only link their own parcel', async () => {
    const owner = await makeUser('CITIZEN');
    const other = await makeUser('CITIZEN');
    await ParcelCache.create({ parcelId: 'DSM-KIN-12-45', ownerId: owner.user.userId, status: 'ACTIVE' });
    const res = await api().post('/api/v1/tickets').set(bearer(other.token)).set('Idempotency-Key', idemKey()).send({ category: 'TRANSFERS', subject: 'Help me', description: 'Something is wrong here.', parcelId: 'DSM-KIN-12-45' });
    expect(res.status).toBe(403);
    const ok = await newTicket(owner.token, { parcelId: 'dsm-kin-12-45' });
    expect(await Ticket.findById(ok.id).lean()).toMatchObject({ parcelId: 'DSM-KIN-12-45' });
  });

  it('agent reply = first response; internal notes stay hidden; offline requester gets push + email', async () => {
    const citizen = await makeUser('CITIZEN', { preferredLanguage: 'sw' });
    const agent = await makeUser('SUPPORT_AGENT');
    const t = await newTicket(citizen.token);

    const queue = await api().get('/api/v1/tickets?assignee=unassigned&status=OPEN&sort=sla').set(bearer(agent.token));
    expect(queue.body.data[0]).toMatchObject({ number: t.number, requester: expect.stringMatching(/User \d+|\./) });

    await say(citizen.token, t.id, 'secret', true).expect(403);
    await say(agent.token, t.id, 'Checked the logs: gateway delay.', true).expect(201);
    const reply = await say(agent.token, t.id, 'Habari! Please ask the buyer to refresh.');
    expect(reply.status).toBe(201);

    const after = await Ticket.findById(t.id).lean();
    expect(after).toMatchObject({ status: 'IN_PROGRESS', assigneeId: agent.user.userId });
    expect(after?.firstResponseAt).toBeTruthy();

    const userView = await api().get(`/api/v1/tickets/${t.id}/messages`).set(bearer(citizen.token));
    expect(userView.body.data.map((m: { body: string }) => m.body)).toEqual(['Habari! Please ask the buyer to refresh.']);
    const staffView = await api().get(`/api/v1/tickets/${t.id}/messages`).set(bearer(agent.token));
    expect(staffView.body.data).toHaveLength(2);

    await new Promise((r) => setTimeout(r, 50));
    const n = await Notification.findOne({ userId: citizen.user.userId, type: 'support.reply' }).lean();
    expect(n?.title).toContain('Huduma kwa wateja');
    expect(outbox.some((m) => m.kind === 'email' && m.to === citizen.user.email)).toBe(true);

    const read = await api().post(`/api/v1/tickets/${t.id}/read`).set(bearer(citizen.token));
    expect(read.body.data.updated).toBe(1);
  });

  it('status transitions, resolution, rating and the 7-day reopen window', async () => {
    const citizen = await makeUser('CITIZEN');
    const agent = await makeUser('SUPPORT_AGENT');
    const t = await newTicket(citizen.token);
    const patch = (body: Record<string, unknown>) => api().patch(`/api/v1/tickets/${t.id}`).set(bearer(agent.token)).set('Idempotency-Key', idemKey()).send(body);

    await api().patch(`/api/v1/tickets/${t.id}`).set(bearer(citizen.token)).set('Idempotency-Key', idemKey()).send({ status: 'RESOLVED' }).expect(403);
    await api().post(`/api/v1/tickets/${t.id}/rating`).set(bearer(citizen.token)).set('Idempotency-Key', idemKey()).send({ stars: 5 }).expect(409);

    const claimed = await api().post(`/api/v1/tickets/${t.id}/claim`).set(bearer(agent.token)).set('Idempotency-Key', idemKey());
    expect(claimed.body.data).toMatchObject({ status: 'IN_PROGRESS', assigneeId: agent.user.userId });
    expect((await patch({ status: 'AWAITING_USER', priority: 'HIGH', tags: ['otp', 'otp'] })).body.data).toMatchObject({ status: 'AWAITING_USER', priority: 'HIGH', tags: ['otp'] });

    await say(citizen.token, t.id, 'Still not working.').expect(201);
    expect((await Ticket.findById(t.id).lean())?.status).toBe('IN_PROGRESS');

    const resolved = await patch({ status: 'RESOLVED' });
    expect(resolved.body.data.sla.state).toBe('MET');
    await new Promise((r) => setTimeout(r, 50));
    expect(await Notification.countDocuments({ userId: citizen.user.userId, type: 'support.resolved' })).toBe(1);

    const rated = await api().post(`/api/v1/tickets/${t.id}/rating`).set(bearer(citizen.token)).set('Idempotency-Key', idemKey()).send({ stars: 4, comment: 'Helpful' });
    expect(rated.body.data.rating).toMatchObject({ stars: 4, comment: 'Helpful' });

    const closed = await api().post(`/api/v1/tickets/${t.id}/close`).set(bearer(citizen.token)).set('Idempotency-Key', idemKey());
    expect(closed.body.data.status).toBe('CLOSED');
    await say(citizen.token, t.id, 'hello?').expect(409);
    expect((await patch({ status: 'IN_PROGRESS' })).body.error.code).toBe('INVALID_STATE');

    const reopened = await api().post(`/api/v1/tickets/${t.id}/reopen`).set(bearer(citizen.token)).set('Idempotency-Key', idemKey());
    expect(reopened.body.data).toMatchObject({ status: 'IN_PROGRESS', rating: null });

    await patch({ status: 'RESOLVED' });
    await Ticket.updateOne({ _id: t.id }, { resolvedAt: new Date(Date.now() - 8 * 86_400_000) });
    const late = await api().post(`/api/v1/tickets/${t.id}/reopen`).set(bearer(citizen.token)).set('Idempotency-Key', idemKey());
    expect(late.body.error.code).toBe('REOPEN_WINDOW_PASSED');
  });

  it('messages can be edited or deleted by their author for 5 minutes', async () => {
    const citizen = await makeUser('CITIZEN');
    const t = await newTicket(citizen.token);
    const m = (await say(citizen.token, t.id, 'tpyo')).body.data as { id: string };
    const edited = await api().patch(`/api/v1/tickets/${t.id}/messages/${m.id}`).set(bearer(citizen.token)).set('Idempotency-Key', idemKey()).send({ body: 'typo' });
    expect(edited.body.data).toMatchObject({ body: 'typo' });
    expect(edited.body.data.editedAt).toBeTruthy();

    const { TicketMessage } = await import('../src/modules/support/support.models');
    await TicketMessage.collection.updateOne({ _id: new Types.ObjectId(m.id) }, { $set: { createdAt: new Date(Date.now() - 6 * 60_000) } });
    const late = await api().delete(`/api/v1/tickets/${t.id}/messages/${m.id}`).set(bearer(citizen.token)).set('Idempotency-Key', idemKey());
    expect(late.body.error.code).toBe('EDIT_WINDOW_PASSED');
  });

  it('attachments: magic-byte checked, stored in MinIO, downloadable only by people who can see the ticket', async () => {
    const citizen = await makeUser('CITIZEN');
    const stranger = await makeUser('CITIZEN');
    const t = await newTicket(citizen.token);
    const bad = await api().post(`/api/v1/tickets/${t.id}/messages`).set(bearer(citizen.token)).set('Idempotency-Key', idemKey()).field('body', 'see file').attach('file', Buffer.from('not a pdf'), { filename: 'x.pdf', contentType: 'application/pdf' });
    expect(bad.body.error.code).toBe('UNSUPPORTED_FILE');
    const res = await api().post(`/api/v1/tickets/${t.id}/messages`).set(bearer(citizen.token)).set('Idempotency-Key', idemKey()).field('body', 'receipt attached').attach('file', PDF, { filename: 'receipt.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(201);
    const att = res.body.data.attachments[0] as { sha256: string; key: string };
    expect(objects.has(att.key)).toBe(true);
    expect(att.key).toMatch(/^tickets\/MLK-\d{6}\/[a-f0-9]{64}\.pdf$/);
    const dl = await api().get(`/api/v1/tickets/${t.id}/attachments/${att.sha256}`).set(bearer(citizen.token));
    expect(dl.status).toBe(200);
    expect(dl.headers['content-type']).toBe('application/pdf');
    await api().get(`/api/v1/tickets/${t.id}/attachments/${att.sha256}`).set(bearer(stranger.token)).expect(404);
  });

  it('agents get a read-only context panel; escalation goes to land officers and back', async () => {
    const citizen = await makeUser('CITIZEN');
    const agent = await makeUser('SUPPORT_AGENT');
    const officer = await makeUser('LAND_OFFICER');
    await ParcelCache.create({ parcelId: 'ARU-ARM-3-7', ownerId: citizen.user.userId, status: 'ENCUMBERED' });
    const t = await newTicket(citizen.token, { parcelId: 'ARU-ARM-3-7', category: 'MORTGAGES' });

    await api().get(`/api/v1/tickets/${t.id}/context`).set(bearer(citizen.token)).expect(403);
    const ctx = await api().get(`/api/v1/tickets/${t.id}/context`).set(bearer(agent.token));
    expect(ctx.body.meta).toEqual({ readOnly: true });
    expect(ctx.body.data.parcels[0]).toMatchObject({ parcelId: 'ARU-ARM-3-7', status: 'ENCUMBERED' });
    expect(ctx.body.data.user.fullName).toBe(citizen.user.fullName);

    const esc = await api().post(`/api/v1/tickets/${t.id}/escalate`).set(bearer(agent.token)).set('Idempotency-Key', idemKey()).send({ note: 'Owner says loan is paid; please check the encumbrance.' });
    expect(esc.status).toBe(201);
    const again = await api().post(`/api/v1/tickets/${t.id}/escalate`).set(bearer(agent.token)).set('Idempotency-Key', idemKey()).send({ note: 'Owner says loan is paid; please check the encumbrance.' });
    expect(again.body.error.code).toBe('ALREADY_ESCALATED');
    await new Promise((r) => setTimeout(r, 50));
    expect(await Notification.countDocuments({ userId: officer.user.userId, type: 'support.escalation' })).toBe(1);

    const list = await api().get('/api/v1/support/escalations').set(bearer(officer.token));
    expect(list.body.data[0]).toMatchObject({ ticketNumber: t.number, parcelId: 'ARU-ARM-3-7', status: 'OPEN' });
    await api().post(`/api/v1/support/escalations/${esc.body.data.id}/done`).set(bearer(agent.token)).set('Idempotency-Key', idemKey()).send({ resolution: 'done' }).expect(403);
    await api().post(`/api/v1/support/escalations/${esc.body.data.id}/done`).set(bearer(officer.token)).set('Idempotency-Key', idemKey()).send({ resolution: 'CRDB released it today.' }).expect(200);
    expect((await Escalation.findById(esc.body.data.id).lean())?.status).toBe('DONE');

    const notes = await api().get(`/api/v1/tickets/${t.id}/messages`).set(bearer(agent.token));
    expect(notes.body.data.map((m: { body: string }) => m.body).join('\n')).toContain('CRDB released it today.');
    expect((await api().get(`/api/v1/tickets/${t.id}/messages`).set(bearer(citizen.token))).body.data).toHaveLength(0);
  });

  it('canned responses, metrics and admin-only soft delete', async () => {
    const citizen = await makeUser('CITIZEN');
    const agent = await makeUser('SUPPORT_AGENT');
    const admin = await makeUser('SYSTEM_ADMIN');
    await api().get('/api/v1/support/canned').set(bearer(citizen.token)).expect(403);
    const c = await api().post('/api/v1/support/canned').set(bearer(agent.token)).set('Idempotency-Key', idemKey()).send({ title: 'Greeting', body: 'Habari!' });
    expect(c.status).toBe(201);
    expect((await api().get('/api/v1/support/canned?q=greet').set(bearer(agent.token))).body.data).toHaveLength(1);

    const t = await newTicket(citizen.token, { category: 'ACCOUNT' });
    await say(agent.token, t.id, 'On it.');
    await api().patch(`/api/v1/tickets/${t.id}`).set(bearer(agent.token)).set('Idempotency-Key', idemKey()).send({ status: 'RESOLVED' });
    await api().post(`/api/v1/tickets/${t.id}/rating`).set(bearer(citizen.token)).set('Idempotency-Key', idemKey()).send({ stars: 5 });
    await newTicket(citizen.token);

    const m = await api().get('/api/v1/support/metrics').set(bearer(admin.token));
    expect(m.body.data).toMatchObject({ openTickets: 1, csat: { average: 5, ratings: 1 } });
    expect(m.body.data.avgFirstResponseMinutes).toBe(0);
    expect(m.body.data.byCategory).toEqual(expect.arrayContaining([{ category: 'ACCOUNT', count: 1 }, { category: 'TRANSFERS', count: 1 }]));

    await api().delete(`/api/v1/tickets/${t.id}`).set(bearer(agent.token)).set('Idempotency-Key', idemKey()).expect(403);
    await api().delete(`/api/v1/tickets/${t.id}`).set(bearer(admin.token)).set('Idempotency-Key', idemKey()).expect(200);
    await api().get(`/api/v1/tickets/${t.id}`).set(bearer(agent.token)).expect(404);
  });
});

describe('SLA clock', () => {
  it('turns WARNING at 75% and BREACHED at 100%', () => {
    const createdAt = new Date('2026-01-01T00:00:00Z');
    const base = { status: 'OPEN', createdAt, firstResponseAt: null, firstResponseDueAt: new Date('2026-01-01T04:00:00Z'), resolveDueAt: new Date('2026-01-02T00:00:00Z'), resolvedAt: null };
    expect(slaView(base, new Date('2026-01-01T02:00:00Z')).state).toBe('OK');
    expect(slaView(base, new Date('2026-01-01T03:00:00Z')).state).toBe('WARNING');
    expect(slaView(base, new Date('2026-01-01T04:00:01Z')).state).toBe('BREACHED');
    expect(slaView({ ...base, firstResponseAt: createdAt }, new Date('2026-01-01T05:00:00Z'))).toMatchObject({ target: 'RESOLUTION', state: 'OK' });
  });
});

describe('/support live chat namespace', () => {
  let server: HttpServer;
  let url: string;
  const sockets: Socket[] = [];

  beforeAll(async () => {
    server = createServer();
    onSocketAttached(attachSupportNamespace);
    attachSocket(server);
    await new Promise<void>((r) => server.listen(0, r));
    url = `http://localhost:${(server.address() as AddressInfo).port}/support`;
  });
  afterAll(async () => {
    sockets.forEach((s) => s.disconnect());
    await closeSocket();
    server.close();
  });

  const client = (token: string) => {
    const s = connect(url, { auth: { token }, transports: ['websocket'], forceNew: true });
    sockets.push(s);
    return s;
  };
  const once = <T>(s: Socket, event: string) => new Promise<T>((r) => s.once(event, r));

  it('rejects strangers, relays typing, fans out messages, keeps internal notes for staff, and reports presence', async () => {
    const citizen = await makeUser('CITIZEN');
    const stranger = await makeUser('CITIZEN');
    const agent = await makeUser('SUPPORT_AGENT');
    const t = await newTicket(citizen.token);

    const bad = connect(url, { auth: { token: 'nope' }, transports: ['websocket'], forceNew: true });
    sockets.push(bad);
    expect((await once<Error>(bad, 'connect_error')).message).toBe('UNAUTHORIZED');

    const user = client(citizen.token);
    const presence = await once<{ agentsOnline: number }>(user, 'presence');
    expect(presence.agentsOnline).toBe(0);

    const staff = client(agent.token);
    expect((await once<{ agentsOnline: number }>(user, 'presence')).agentsOnline).toBe(1);

    const evil = client(stranger.token);
    expect(await evil.emitWithAck('ticket:join', { ticketId: t.id })).toEqual({ ok: false, error: 'FORBIDDEN' });
    expect(await user.emitWithAck('ticket:join', { ticketId: t.id })).toEqual({ ok: true });
    expect(await staff.emitWithAck('ticket:join', { ticketId: t.id })).toEqual({ ok: true });

    const typing = once<{ typing: boolean; role: string }>(user, 'typing');
    staff.emit('typing', { ticketId: t.id, typing: true });
    expect(await typing).toMatchObject({ typing: true, role: 'SUPPORT_AGENT' });

    const userGot: string[] = [];
    user.on('message:new', (m: { body: string }) => userGot.push(m.body));
    const staffMsg = once<{ body: string; internal: boolean }>(staff, 'message:new');
    await say(agent.token, t.id, 'internal only', true).expect(201);
    expect(await staffMsg).toMatchObject({ body: 'internal only', internal: true });

    const visible = once<{ body: string }>(user, 'message:new');
    await say(agent.token, t.id, 'Hello from support').expect(201);
    expect((await visible).body).toBe('Hello from support');
    expect(userGot).toEqual(['Hello from support']);

    // The requester was watching, so no push/email for that reply.
    await new Promise((r) => setTimeout(r, 50));
    expect(await Notification.countDocuments({ userId: citizen.user.userId, type: 'support.reply' })).toBe(0);

    const receipt = once<{ userId: string }>(staff, 'read');
    await api().post(`/api/v1/tickets/${t.id}/read`).set(bearer(citizen.token)).expect(200);
    expect((await receipt).userId).toBe(citizen.user.userId);

    const gone = once<{ agentsOnline: number }>(user, 'presence');
    staff.disconnect();
    expect((await gone).agentsOnline).toBe(0);
  });
});
