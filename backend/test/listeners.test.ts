import { describe, expect, it, vi } from 'vitest';
import { dispatch, type MilkiEvent } from '../src/core/fabric/events';
import { ledger } from '../src/core/fabric/ledger';
import { AuditLog } from '../src/modules/audit/audit.model';
import { DocumentFile } from '../src/modules/documents/document-file.model';
import { registerLedgerListeners } from '../src/modules/ledger/ledger.listeners';
import { Notification } from '../src/modules/notifications/notification.model';
import { ParcelCache } from '../src/modules/parcels/parcel-cache.model';
import { TransferCache } from '../src/modules/transfers/transfer-cache.model';
import { api, makeUser } from './helpers';

registerLedgerListeners();
const evaluate = vi.mocked(ledger.evaluate);

const parcel = (ownerId: string, status = 'ACTIVE') => ({
  parcelId: 'DSM-KIN-12-45',
  titleNumber: 'T',
  region: 'Dar es Salaam',
  district: 'Kinondoni',
  ward: 'W',
  blockNumber: '12',
  plotNumber: '45',
  area: 100,
  landUse: 'RESIDENTIAL',
  location: { latitude: -6, longitude: 39, boundary: null, address: null },
  ownerId,
  ownerNidaHash: 'h',
  ownershipVersion: 1,
  status,
  frozen: false,
  retired: false,
  activeTransferId: null,
  activeEncumbranceIds: [],
  openDisputeIds: [],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-02T00:00:00Z',
  lastTxId: 't',
});

const transfer = (sellerId: string, buyerId: string, status = 'INITIATED') => ({
  transferId: 'TRF-0123456789ABCDEF',
  parcelId: 'DSM-KIN-12-45',
  sellerId,
  buyerId,
  status,
  verifiedBy: null,
  approvedBy: null,
  closedReason: null,
  history: [{ status, at: '2026-01-02T00:00:00Z', by: { id: sellerId, mspId: 'Org1MSP', role: 'CITIZEN' }, txId: 't' }],
  createdAt: '2026-01-02T00:00:00Z',
  updatedAt: '2026-01-02T00:00:00Z',
  lastTxId: 't',
});

let txn = 0;
const event = (entity: string, action: string, data: Record<string, string | null> = {}, ageMs = 0): MilkiEvent => ({
  entity,
  action,
  id: entity === 'Transfer' ? 'TRF-0123456789ABCDEF' : entity === 'Document' ? 'DOC-2222222222222222' : 'DSM-KIN-12-45',
  parcelId: 'DSM-KIN-12-45',
  status: 'X',
  txId: `tx-${++txn}`,
  timestamp: new Date(Date.now() - ageMs).toISOString(),
  actor: { id: 'usr_actor', mspId: 'Org1MSP', role: 'CITIZEN' },
  data,
});
const ctx = (e: MilkiEvent) => ({ name: `milki.${e.entity}.${e.action}`, blockNumber: 9, transactionId: e.txId });

describe('ledger event handlers', () => {
  it('Transfer.Initiated: refreshes both caches, audits, and notifies the buyer in their language', async () => {
    const seller = await makeUser('CITIZEN', { fullName: 'Asha Mwakyusa' });
    const buyer = await makeUser('CITIZEN', { preferredLanguage: 'sw' });
    evaluate.mockImplementation(async (_w, fn) => (fn === 'GetParcel' ? parcel(seller.user.userId, 'PENDING_TRANSFER') : transfer(seller.user.userId, buyer.user.userId)));

    const e = event('Transfer', 'Initiated', { sellerId: seller.user.userId, buyerId: buyer.user.userId });
    await dispatch(e, ctx(e));

    expect(await ParcelCache.findOne({ parcelId: 'DSM-KIN-12-45' }).lean()).toMatchObject({ status: 'PENDING_TRANSFER', ownerId: seller.user.userId, lastBlock: 9 });
    expect(await TransferCache.findOne({ transferId: 'TRF-0123456789ABCDEF' }).lean()).toMatchObject({ status: 'INITIATED', buyerId: buyer.user.userId });
    expect(await AuditLog.findOne({ action: 'ledger.Transfer.Initiated' }).lean()).toMatchObject({ txId: e.txId, entityId: 'TRF-0123456789ABCDEF' });

    const notes = await Notification.find({}).lean();
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ userId: buyer.user.userId, type: 'Transfer.Initiated', title: 'Uhamisho unakusubiri', data: { transferId: 'TRF-0123456789ABCDEF' } });
    expect(notes[0]?.body).toContain('Asha M.');
  });

  it('Transfer.Approved: buyer hears they own it, seller hears it moved', async () => {
    const seller = await makeUser('CITIZEN');
    const buyer = await makeUser('CITIZEN', { fullName: 'Juma Hassan' });
    evaluate.mockImplementation(async (_w, fn) => (fn === 'GetParcel' ? parcel(buyer.user.userId) : transfer(seller.user.userId, buyer.user.userId, 'COMPLETED')));
    const e = event('Transfer', 'Approved', { sellerId: seller.user.userId, buyerId: buyer.user.userId });
    await dispatch(e, ctx(e));
    const byUser = Object.fromEntries((await Notification.find({}).lean()).map((n) => [n.userId, n.body]));
    expect(byUser[buyer.user.userId]).toContain('recorded in your name');
    expect(byUser[seller.user.userId]).toContain('moved to Juma H.');
  });

  it('notifies once per transaction, and not at all for replayed history', async () => {
    const owner = await makeUser('CITIZEN');
    evaluate.mockResolvedValue(parcel(owner.user.userId, 'ENCUMBERED'));
    const e = event('Encumbrance', 'Added', { lenderName: 'CRDB Bank', type: 'MORTGAGE' });
    await dispatch(e, ctx(e));
    await dispatch(e, ctx(e)); // reconnect replay of the same tx
    const old = event('Encumbrance', 'Released', { lenderName: 'CRDB Bank', type: 'MORTGAGE' }, 2 * 60 * 60 * 1000);
    await dispatch(old, ctx(old));
    const notes = await Notification.find({}).lean();
    expect(notes.map((n) => n.title)).toEqual(['Mortgage registered']);
    expect(notes[0]?.body).toBe('CRDB Bank registered a mortgage on DSM-KIN-12-45.');
    expect(await AuditLog.countDocuments({ action: /^ledger\./ })).toBe(2); // audit still records both, once each
  });

  it('Document events mark the off-chain file record ATTACHED / SUPERSEDED', async () => {
    const owner = await makeUser('CITIZEN');
    evaluate.mockResolvedValue(parcel(owner.user.userId));
    const base = { sha256: 'a'.repeat(64), objectKey: 'k', mimeType: 'application/pdf', size: 1, targetType: 'PARCEL' as const, targetId: 'DSM-KIN-12-45', documentType: 'TITLE_DEED', uploadedBy: 'u' };
    await DocumentFile.create({ ...base, documentId: 'DOC-1111111111111111', status: 'ATTACHED' as const });
    await DocumentFile.create({ ...base, documentId: 'DOC-2222222222222222', objectKey: 'k2', supersedes: 'DOC-1111111111111111' });
    const e = event('Document', 'Superseded');
    await dispatch(e, ctx(e));
    expect((await DocumentFile.findOne({ documentId: 'DOC-2222222222222222' }).lean())?.status).toBe('ATTACHED');
    expect((await DocumentFile.findOne({ documentId: 'DOC-1111111111111111' }).lean())?.status).toBe('SUPERSEDED');
  });

  it('a failing handler does not stop the others', async () => {
    const owner = await makeUser('CITIZEN');
    evaluate.mockRejectedValue(new Error('peer down'));
    const e = event('Dispute', 'Flagged');
    await ParcelCache.create({ parcelId: 'DSM-KIN-12-45', ownerId: owner.user.userId });
    await dispatch(e, ctx(e));
    expect(await AuditLog.countDocuments({ action: 'ledger.Dispute.Flagged' })).toBe(1);
    expect((await Notification.findOne({}).lean())?.title).toBe('Dispute flagged');
  });
});

describe('notifications API', () => {
  it('list (with unread count), mark read, mark all read, delete — own notifications only', async () => {
    const me = await makeUser('CITIZEN');
    const other = await makeUser('CITIZEN');
    const [a] = await Notification.insertMany([
      { userId: me.user.userId, type: 't', title: 'A', body: 'a' },
      { userId: me.user.userId, type: 't', title: 'B', body: 'b' },
      { userId: other.user.userId, type: 't', title: 'C', body: 'c' },
    ]);
    const auth = { Authorization: `Bearer ${me.token}` };
    const list = await api().get('/api/v1/notifications').set(auth);
    expect(list.body.meta).toMatchObject({ total: 2, unread: 2 });

    await api().post(`/api/v1/notifications/${a!._id}/read`).set(auth).expect(200);
    expect((await api().get('/api/v1/notifications?unread=true').set(auth)).body.meta.total).toBe(1);
    expect((await api().post('/api/v1/notifications/read-all').set(auth)).body.data.updated).toBe(1);
    await api().delete(`/api/v1/notifications/${a!._id}`).set(auth).expect(200);
    expect((await api().get('/api/v1/notifications').set(auth)).body.meta.total).toBe(1);

    const theirs = await Notification.findOne({ userId: other.user.userId }).lean();
    expect((await api().post(`/api/v1/notifications/${theirs!._id}/read`).set(auth)).status).toBe(404);
    expect((await api().delete(`/api/v1/notifications/${theirs!._id}`).set(auth)).status).toBe(404);
    expect((await api().post('/api/v1/notifications/nope/read').set(auth)).status).toBe(400);
  });

  it('device tokens: register (upsert) and remove', async () => {
    const me = await makeUser('CITIZEN');
    const auth = { Authorization: `Bearer ${me.token}` };
    const token = 'fcm-token-'.padEnd(40, 'x');
    await api().post('/api/v1/devices').set(auth).send({ token, platform: 'android' }).expect(200);
    await api().post('/api/v1/devices').set(auth).send({ token, platform: 'android' }).expect(200);
    const { DeviceToken } = await import('../src/modules/notifications/notification.model');
    expect(await DeviceToken.countDocuments({ userId: me.user.userId })).toBe(1);
    await api().delete(`/api/v1/devices/${token}`).set(auth).expect(200);
    expect(await DeviceToken.countDocuments()).toBe(0);
    expect((await api().post('/api/v1/devices').set(auth).send({ token: 'x', platform: 'fax' })).status).toBe(400);
  });
});
