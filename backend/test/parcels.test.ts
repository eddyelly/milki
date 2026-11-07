import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../src/core/errors';
import { ledger } from '../src/core/fabric/ledger';
import { AuditLog } from '../src/modules/audit/audit.model';
import { ParcelCache } from '../src/modules/parcels/parcel-cache.model';
import type { LedgerParcel } from '../src/modules/parcels/parcel.types';
import { api, idemKey, makeUser, reauth } from './helpers';

const evaluate = vi.mocked(ledger.evaluate);
const submit = vi.mocked(ledger.submit);
const TX = 'a'.repeat(64);

const ledgerParcel = (over: Partial<LedgerParcel> = {}): LedgerParcel => ({
  docType: 'parcel',
  parcelId: 'DSM-KIN-12-45',
  titleNumber: 'DSM/KIN/2026/0045',
  region: 'Dar es Salaam',
  district: 'Kinondoni',
  ward: 'Mikocheni',
  blockNumber: '12',
  plotNumber: '45',
  area: 650.5,
  landUse: 'RESIDENTIAL',
  location: { latitude: -6.76, longitude: 39.24, boundary: null, address: null },
  ownerId: 'usr_000000000000000000000000',
  ownerNidaHash: 'f'.repeat(64),
  ownershipVersion: 1,
  status: 'ACTIVE',
  frozen: false,
  frozenReason: null,
  retired: false,
  retiredReason: null,
  lastChangeNote: null,
  activeTransferId: null,
  transferIds: [],
  activeEncumbranceIds: [],
  encumbranceIds: [],
  openDisputeIds: [],
  disputeIds: [],
  documentIds: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  createdBy: { id: 'r', mspId: 'Org1MSP', role: 'REGISTRAR' },
  updatedAt: '2026-01-01T00:00:00.000Z',
  updatedBy: { id: 'r', mspId: 'Org1MSP', role: 'REGISTRAR' },
  lastTxId: TX,
  ...over,
});

const newParcel = (owner: Record<string, string>) => ({
  parcelId: 'dsm-kin-12-45',
  titleNumber: 'DSM/KIN/2026/0045',
  region: 'Dar es Salaam',
  district: 'Kinondoni',
  ward: 'Mikocheni',
  blockNumber: '12',
  plotNumber: '45',
  area: 650.5,
  landUse: 'RESIDENTIAL',
  location: { latitude: -6.7631, longitude: 39.2462 },
  owner,
});

describe('POST /parcels (T3 ledger write)', () => {
  it('registers via the ledger as the registrar and returns 202 { txId, SUBMITTED }', async () => {
    const reg = await makeUser('REGISTRAR');
    const owner = await makeUser('CITIZEN');
    submit.mockResolvedValueOnce({ txId: TX, result: ledgerParcel() });

    const res = await api()
      .post('/api/v1/parcels')
      .set('Authorization', `Bearer ${reg.token}`)
      .set('Idempotency-Key', idemKey())
      .set('X-Reauth-Token', await reauth(reg.token))
      .send(newParcel({ nida: owner.nida }));

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ data: { txId: TX, parcelId: 'DSM-KIN-12-45', status: 'SUBMITTED' }, meta: null });
    const [who, fn, args, opts] = submit.mock.calls[0]!;
    expect(who).toMatchObject({ userId: reg.user.userId, role: 'REGISTRAR' });
    expect(fn).toBe('RegisterParcel');
    const payload = JSON.parse(args[0]!);
    expect(payload).toMatchObject({ parcelId: 'DSM-KIN-12-45', ownerId: owner.user.userId, ownerNidaHash: owner.user.nidaHash });
    expect(payload).not.toHaveProperty('owner');
    expect(JSON.stringify(payload)).not.toContain(owner.nida); // rule 4: NIDA itself never reaches the ledger
    expect(opts).toMatchObject({ entityType: 'Parcel', entityId: 'DSM-KIN-12-45' });
    expect(await AuditLog.findOne({ action: 'parcel.register' }).lean()).toMatchObject({ txId: TX, entityId: 'DSM-KIN-12-45' });
  });

  it('requires the REGISTRAR role', async () => {
    for (const role of ['CITIZEN', 'LAND_OFFICER', 'BANK_OFFICER', 'SUPPORT_AGENT', 'SYSTEM_ADMIN'] as const) {
      const u = await makeUser(role);
      const res = await api().post('/api/v1/parcels').set('Authorization', `Bearer ${u.token}`).set('Idempotency-Key', idemKey()).send({});
      expect(res.status, role).toBe(403);
    }
    expect(submit).not.toHaveBeenCalled();
  });

  it('requires a single-use re-auth token', async () => {
    const reg = await makeUser('REGISTRAR');
    const owner = await makeUser('CITIZEN');
    const none = await api().post('/api/v1/parcels').set('Authorization', `Bearer ${reg.token}`).set('Idempotency-Key', idemKey()).send(newParcel({ userId: owner.user.userId }));
    expect(none.status).toBe(401);
    expect(none.body.error.code).toBe('REAUTH_REQUIRED');

    submit.mockResolvedValue({ txId: TX, result: ledgerParcel() });
    const token = await reauth(reg.token);
    const first = await api().post('/api/v1/parcels').set('Authorization', `Bearer ${reg.token}`).set('Idempotency-Key', idemKey()).set('X-Reauth-Token', token).send(newParcel({ userId: owner.user.userId }));
    expect(first.status).toBe(202);
    const reused = await api().post('/api/v1/parcels').set('Authorization', `Bearer ${reg.token}`).set('Idempotency-Key', idemKey()).set('X-Reauth-Token', token).send(newParcel({ userId: owner.user.userId }));
    expect(reused.status).toBe(401);

    const other = await makeUser('REGISTRAR');
    const stolen = await api().post('/api/v1/parcels').set('Authorization', `Bearer ${other.token}`).set('Idempotency-Key', idemKey()).set('X-Reauth-Token', await reauth(reg.token)).send(newParcel({ userId: owner.user.userId }));
    expect(stolen.status).toBe(401);
  });

  it('idempotency: replays a completed write instead of submitting twice', async () => {
    const reg = await makeUser('REGISTRAR');
    const owner = await makeUser('CITIZEN');
    submit.mockResolvedValue({ txId: TX, result: ledgerParcel() });
    const key = idemKey();
    const send = async (body: object) =>
      api().post('/api/v1/parcels').set('Authorization', `Bearer ${reg.token}`).set('Idempotency-Key', key).set('X-Reauth-Token', await reauth(reg.token)).send(body);

    const a = await send(newParcel({ userId: owner.user.userId }));
    const b = await send(newParcel({ userId: owner.user.userId }));
    expect(a.status).toBe(202);
    expect(b.status).toBe(202);
    expect(b.headers['idempotent-replayed']).toBe('true');
    expect(b.body).toEqual(a.body);
    expect(submit).toHaveBeenCalledTimes(1);

    const c = await send({ ...newParcel({ userId: owner.user.userId }), area: 1 });
    expect(c.status).toBe(422);
    expect(c.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');

    const missing = await api().post('/api/v1/parcels').set('Authorization', `Bearer ${reg.token}`).send({});
    expect(missing.body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  it('a failed request releases its key, so a corrected retry with the same key works', async () => {
    const reg = await makeUser('REGISTRAR');
    const owner = await makeUser('CITIZEN');
    const key = idemKey();
    const first = await api().post('/api/v1/parcels').set('Authorization', `Bearer ${reg.token}`).set('Idempotency-Key', key).send(newParcel({ userId: owner.user.userId }));
    expect(first.status).toBe(401); // forgot to re-authenticate
    submit.mockResolvedValueOnce({ txId: TX, result: ledgerParcel() });
    const retry = await api().post('/api/v1/parcels').set('Authorization', `Bearer ${reg.token}`).set('Idempotency-Key', key).set('X-Reauth-Token', await reauth(reg.token)).send(newParcel({ userId: owner.user.userId }));
    expect(retry.status).toBe(202);
  });

  it('owner must be an active, registered citizen', async () => {
    const reg = await makeUser('REGISTRAR');
    const officer = await makeUser('LAND_OFFICER');
    const pending = await makeUser('CITIZEN', { status: 'PENDING_VERIFICATION' });
    const cases: [Record<string, string>, number, string][] = [
      [{ nida: '19990101123450009999' }, 404, 'OWNER_NOT_FOUND'],
      [{ userId: officer.user.userId }, 404, 'OWNER_NOT_FOUND'],
      [{ userId: pending.user.userId }, 400, 'OWNER_NOT_ACTIVE'],
    ];
    for (const [owner, status, code] of cases) {
      const res = await api().post('/api/v1/parcels').set('Authorization', `Bearer ${reg.token}`).set('Idempotency-Key', idemKey()).set('X-Reauth-Token', await reauth(reg.token)).send(newParcel(owner));
      expect(res.status).toBe(status);
      expect(res.body.error.code).toBe(code);
    }
    expect(submit).not.toHaveBeenCalled();
  });

  it('validates the body before touching the ledger', async () => {
    const reg = await makeUser('REGISTRAR');
    const res = await api()
      .post('/api/v1/parcels')
      .set('Authorization', `Bearer ${reg.token}`)
      .set('Idempotency-Key', idemKey())
      .set('X-Reauth-Token', await reauth(reg.token))
      .send({ ...newParcel({ userId: 'usr_x' }), parcelId: 'bad id', area: -5 });
    expect(res.status).toBe(400);
    expect(res.body.error.details.fields.map((f: { path: string }) => f.path)).toEqual(expect.arrayContaining(['parcelId', 'area', 'owner.userId']));
    expect(submit).not.toHaveBeenCalled();
  });

  it('passes chaincode guard errors through as readable API errors', async () => {
    const reg = await makeUser('REGISTRAR');
    const owner = await makeUser('CITIZEN');
    submit.mockRejectedValueOnce(new AppError(409, 'CONFLICT', 'Parcel DSM-KIN-12-45 is already registered.', { parcelId: 'DSM-KIN-12-45' }));
    const res = await api().post('/api/v1/parcels').set('Authorization', `Bearer ${reg.token}`).set('Idempotency-Key', idemKey()).set('X-Reauth-Token', await reauth(reg.token)).send(newParcel({ userId: owner.user.userId }));
    expect(res.status).toBe(409);
    expect(res.body.error).toEqual({ code: 'CONFLICT', message: 'Parcel DSM-KIN-12-45 is already registered.', details: { parcelId: 'DSM-KIN-12-45' } });
  });
});

describe('PATCH / freeze / unfreeze / retire', () => {
  it('map to the chaincode functions with the right arguments', async () => {
    const reg = await makeUser('REGISTRAR');
    submit.mockResolvedValue({ txId: TX, result: ledgerParcel() });
    const call = async (method: 'patch' | 'post', path: string, body: object) =>
      api()[method](`/api/v1/parcels/DSM-KIN-12-45${path}`).set('Authorization', `Bearer ${reg.token}`).set('Idempotency-Key', idemKey()).set('X-Reauth-Token', await reauth(reg.token)).send(body);

    expect((await call('patch', '', { area: 640, areaCorrectionReason: 'Resurvey 2026' })).status).toBe(202);
    expect((await call('post', '/freeze', { reason: 'Court order 12/2026' })).status).toBe(202);
    expect((await call('post', '/unfreeze', { reason: 'Order lifted' })).status).toBe(202);
    expect((await call('post', '/retire', { reason: 'Merged into DSM-KIN-12-50' })).status).toBe(202);
    expect(submit.mock.calls.map((c) => [c[1], c[2]])).toEqual([
      ['UpdateParcel', ['DSM-KIN-12-45', JSON.stringify({ area: 640, areaCorrectionReason: 'Resurvey 2026' })]],
      ['FreezeParcel', ['DSM-KIN-12-45', 'Court order 12/2026']],
      ['UnfreezeParcel', ['DSM-KIN-12-45', 'Order lifted']],
      ['RetireParcel', ['DSM-KIN-12-45', 'Merged into DSM-KIN-12-50']],
    ]);
    expect(await AuditLog.countDocuments({ action: /^parcel\./ })).toBe(4);
  });

  it('validate input: area needs a reason, no unknown fields, reasons required', async () => {
    const reg = await makeUser('REGISTRAR');
    const call = async (method: 'patch' | 'post', path: string, body: object) =>
      api()[method](`/api/v1/parcels/DSM-KIN-12-45${path}`).set('Authorization', `Bearer ${reg.token}`).set('Idempotency-Key', idemKey()).set('X-Reauth-Token', await reauth(reg.token)).send(body);
    expect((await call('patch', '', { area: 640 })).body.error.message).toContain('needs a reason');
    expect((await call('patch', '', { ownerId: 'usr_x' })).status).toBe(400);
    expect((await call('patch', '', {})).status).toBe(400);
    expect((await call('post', '/freeze', {})).status).toBe(400);
    expect(submit).not.toHaveBeenCalled();
  });
});

describe('reads', () => {
  it('GET /parcels/:id comes from the ledger; officials see the owner, never the NIDA hash', async () => {
    const owner = await makeUser('CITIZEN');
    const officer = await makeUser('LAND_OFFICER');
    evaluate.mockResolvedValue(ledgerParcel({ ownerId: owner.user.userId }));
    const res = await api().get('/api/v1/parcels/dsm-kin-12-45').set('Authorization', `Bearer ${officer.token}`);
    expect(res.status).toBe(200);
    expect(res.body.meta).toEqual({ source: 'ledger' });
    expect(res.body.data.owner).toMatchObject({ userId: owner.user.userId, fullName: owner.user.fullName });
    expect(res.body.data).not.toHaveProperty('ownerNidaHash');
    expect(evaluate).toHaveBeenCalledWith(expect.objectContaining({ role: 'LAND_OFFICER' }), 'GetParcel', ['DSM-KIN-12-45']);
  });

  it("citizens can read only their own parcels", async () => {
    const owner = await makeUser('CITIZEN');
    const other = await makeUser('CITIZEN');
    evaluate.mockResolvedValue(ledgerParcel({ ownerId: owner.user.userId }));
    expect((await api().get('/api/v1/parcels/DSM-KIN-12-45').set('Authorization', `Bearer ${owner.token}`)).body.data.owner).toEqual({ userId: owner.user.userId });
    const denied = await api().get('/api/v1/parcels/DSM-KIN-12-45').set('Authorization', `Bearer ${other.token}`);
    expect(denied.status).toBe(403);
    const hist = await api().get('/api/v1/parcels/DSM-KIN-12-45/history').set('Authorization', `Bearer ${other.token}`);
    expect(hist.status).toBe(403);
  });

  it('history is mapped to a compact ownership chain', async () => {
    const officer = await makeUser('REGISTRAR');
    evaluate.mockResolvedValueOnce(ledgerParcel()).mockResolvedValueOnce([
      { txId: 'tx1', timestamp: '2026-01-01T00:00:00.000Z', isDelete: false, parcel: ledgerParcel() },
      { txId: 'tx2', timestamp: '2026-02-01T00:00:00.000Z', isDelete: false, parcel: ledgerParcel({ ownerId: 'usr_b', ownershipVersion: 2, lastChangeNote: null }) },
    ]);
    const res = await api().get('/api/v1/parcels/DSM-KIN-12-45/history').set('Authorization', `Bearer ${officer.token}`);
    expect(res.body.data.map((e: { ownerId: string; ownershipVersion: number }) => [e.ownerId, e.ownershipVersion])).toEqual([
      ['usr_000000000000000000000000', 1],
      ['usr_b', 2],
    ]);
  });

  it('related lists call the matching chaincode reads', async () => {
    const officer = await makeUser('REGISTRAR');
    evaluate.mockImplementation(async (_who, fn) => (fn === 'GetParcel' ? ledgerParcel() : [{ fn }]));
    for (const [path, fn] of [
      ['encumbrances', 'GetEncumbrances'],
      ['disputes', 'GetDisputes'],
      ['transfers', 'GetParcelTransfers'],
      ['documents', 'GetDocuments'],
    ]) {
      const res = await api().get(`/api/v1/parcels/DSM-KIN-12-45/${path}`).set('Authorization', `Bearer ${officer.token}`);
      expect(res.body.data).toEqual([{ fn }]);
    }
  });

  it('maps ledger errors (e.g. NOT_FOUND) to the error envelope', async () => {
    const officer = await makeUser('REGISTRAR');
    evaluate.mockRejectedValueOnce(new AppError(404, 'NOT_FOUND', 'Parcel DSM-KIN-99-99 is not registered on Milki.'));
    const res = await api().get('/api/v1/parcels/DSM-KIN-99-99').set('Authorization', `Bearer ${officer.token}`);
    expect(res.status).toBe(404);
    expect(res.body.error.message).toBe('Parcel DSM-KIN-99-99 is not registered on Milki.');
    expect((await api().get('/api/v1/parcels/not-an-id').set('Authorization', `Bearer ${officer.token}`)).status).toBe(400);
  });

  it('GET /parcels lists from the cache with filters, search, sort and pagination; citizens see only theirs', async () => {
    const owner = await makeUser('CITIZEN');
    const officer = await makeUser('LAND_OFFICER');
    const rows = [
      { parcelId: 'DSM-KIN-12-45', region: 'Dar es Salaam', district: 'Kinondoni', ownerId: owner.user.userId, status: 'ACTIVE', area: 500, landUse: 'RESIDENTIAL', ledgerUpdatedAt: new Date('2026-01-03') },
      { parcelId: 'DSM-KIN-12-46', region: 'Dar es Salaam', district: 'Kinondoni', ownerId: 'usr_other', status: 'ENCUMBERED', area: 900, landUse: 'COMMERCIAL', ledgerUpdatedAt: new Date('2026-01-02') },
      { parcelId: 'ARU-ARU-01-01', region: 'Arusha', district: 'Arusha', ownerId: 'usr_other', status: 'DISPUTED', area: 1200, landUse: 'AGRICULTURAL', ledgerUpdatedAt: new Date('2026-01-01') },
    ];
    await ParcelCache.insertMany(rows);
    const get = (token: string, qs: string) => api().get(`/api/v1/parcels${qs}`).set('Authorization', `Bearer ${token}`);

    const all = await get(officer.token, '');
    expect(all.body.data.map((p: { parcelId: string }) => p.parcelId)).toEqual(['DSM-KIN-12-45', 'DSM-KIN-12-46', 'ARU-ARU-01-01']);
    expect(all.body.meta).toEqual({ page: 1, limit: 20, total: 3, pages: 1, source: 'cache' });

    expect((await get(officer.token, '?status=ENCUMBERED,DISPUTED&sort=-area')).body.data.map((p: { parcelId: string }) => p.parcelId)).toEqual(['ARU-ARU-01-01', 'DSM-KIN-12-46']);
    expect((await get(officer.token, '?region=arusha')).body.meta.total).toBe(1);
    expect((await get(officer.token, '?q=kin-12')).body.meta.total).toBe(2);
    expect((await get(officer.token, '?q=.*')).body.meta.total).toBe(0); // regex input is escaped
    const page2 = await get(officer.token, '?limit=2&page=2&sort=parcelId');
    expect(page2.body.data.map((p: { parcelId: string }) => p.parcelId)).toEqual(['DSM-KIN-12-46']);
    expect(page2.body.meta.pages).toBe(2);

    const mine = await get(owner.token, '?ownerId=usr_other');
    expect(mine.body.data.map((p: { parcelId: string }) => p.parcelId)).toEqual(['DSM-KIN-12-45']);
    expect((await get(officer.token, '?status=NOPE')).status).toBe(400);
    expect((await get(officer.token, '?limit=500')).status).toBe(400);
  });
});
