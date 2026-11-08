import { describe, expect, it, vi } from 'vitest';
import { piiHash } from '../src/core/crypto';
import { ledger } from '../src/core/fabric/ledger';
import { forgetIdentity } from '../src/core/fabric/wallet';
import { AuditLog } from '../src/modules/audit/audit.model';
import { EncumbranceCache } from '../src/modules/encumbrances/encumbrance.service';
import { User } from '../src/modules/users/user.model';
import { api, idemKey, makeUser, reauth } from './helpers';
import { outbox } from './outbox';

const evaluate = vi.mocked(ledger.evaluate);
const submit = vi.mocked(ledger.submit);
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

const parcel = (over: Record<string, unknown> = {}) => ({
  parcelId: 'DSM-KIN-12-45',
  titleNumber: 'T-1',
  region: 'Dar es Salaam',
  district: 'Kinondoni',
  ward: 'Mikocheni',
  area: 500,
  landUse: 'RESIDENTIAL',
  status: 'ACTIVE',
  ownerId: 'usr_x',
  ownerNidaHash: piiHash('19900101123450000101'),
  ownershipVersion: 2,
  activeEncumbranceIds: [],
  openDisputeIds: [],
  frozen: false,
  activeTransferId: null,
  lastTxId: 'tx',
  updatedAt: '2026-01-01T00:00:00Z',
  ...over,
});

describe('encumbrances (bank officers, T3)', () => {
  it('a bank officer adds, updates and releases with re-authentication; lists show only their bank', async () => {
    const bank = await makeUser('BANK_OFFICER', { bankCode: 'CRDB', bankName: 'CRDB Bank' });
    const other = await makeUser('BANK_OFFICER', { bankCode: 'NMB', bankName: 'NMB Bank' });
    const citizen = await makeUser('CITIZEN');

    await api().post('/api/v1/parcels/DSM-KIN-12-45/encumbrances').set(bearer(citizen.token)).set('Idempotency-Key', idemKey()).send({ type: 'MORTGAGE', amount: 1, reference: 'L-1' }).expect(403);
    const noReauth = await api().post('/api/v1/parcels/DSM-KIN-12-45/encumbrances').set(bearer(bank.token)).set('Idempotency-Key', idemKey()).send({ type: 'MORTGAGE', amount: 1, reference: 'L-1' });
    expect(noReauth.status).toBe(401);

    submit.mockResolvedValueOnce({ txId: 'tx-add', result: { encumbranceId: 'ENC-0123456789ABCDEF', parcelId: 'DSM-KIN-12-45', type: 'MORTGAGE' } } as never);
    const add = await api()
      .post('/api/v1/parcels/dsm-kin-12-45/encumbrances')
      .set(bearer(bank.token))
      .set('Idempotency-Key', idemKey())
      .set('X-Reauth-Token', await reauth(bank.token))
      .send({ type: 'MORTGAGE', amount: 120_000_000, reference: 'CRDB/HL/2026/001' });
    expect(add.status).toBe(202);
    expect(add.body.data).toMatchObject({ txId: 'tx-add', encumbranceId: 'ENC-0123456789ABCDEF' });
    const [who, fn, args] = submit.mock.calls[0]!;
    expect(who).toMatchObject({ userId: bank.user.userId, role: 'BANK_OFFICER', bankCode: 'CRDB' });
    expect(fn).toBe('AddEncumbrance');
    expect(JSON.parse(args[1]!)).toEqual({ type: 'MORTGAGE', lenderName: 'CRDB Bank', amount: 120_000_000, currency: 'TZS', reference: 'CRDB/HL/2026/001' });

    submit.mockResolvedValueOnce({ txId: 'tx-rel', result: { parcelId: 'DSM-KIN-12-45' } } as never);
    const rel = await api()
      .post('/api/v1/encumbrances/ENC-0123456789ABCDEF/release')
      .set(bearer(bank.token))
      .set('Idempotency-Key', idemKey())
      .set('X-Reauth-Token', await reauth(bank.token))
      .send({ reason: 'Loan repaid in full' });
    expect(rel.status).toBe(202);
    expect(submit.mock.calls[1]![1]).toBe('ReleaseEncumbrance');

    await EncumbranceCache.create([
      { encumbranceId: 'ENC-0000000000000001', parcelId: 'DSM-KIN-12-45', lenderCode: 'CRDB', status: 'ACTIVE', ledgerUpdatedAt: new Date() },
      { encumbranceId: 'ENC-0000000000000002', parcelId: 'ARU-ARM-3-7', lenderCode: 'NMB', status: 'ACTIVE', ledgerUpdatedAt: new Date() },
    ]);
    const mine = await api().get('/api/v1/encumbrances').set(bearer(bank.token));
    expect(mine.body.data.map((e: { encumbranceId: string }) => e.encumbranceId)).toEqual(['ENC-0000000000000001']);
    const theirs = await api().get('/api/v1/encumbrances').set(bearer(other.token));
    expect(theirs.body.data.map((e: { encumbranceId: string }) => e.encumbranceId)).toEqual(['ENC-0000000000000002']);
    expect(await AuditLog.countDocuments({ action: /^encumbrance\./ })).toBe(2);
  });
});

describe('admin: users, offices, audit', () => {
  it('creates a staff account with a one-time password that can sign in', async () => {
    const admin = await makeUser('SYSTEM_ADMIN');
    const officer = await makeUser('LAND_OFFICER');
    const body = { role: 'LAND_OFFICER', fullName: 'Neema Kileo', phone: '0713 222 333', email: 'neema@lands.go.tz' };
    await api().post('/api/v1/admin/users').set(bearer(officer.token)).set('Idempotency-Key', idemKey()).send(body).expect(403);
    const res = await api().post('/api/v1/admin/users').set(bearer(admin.token)).set('Idempotency-Key', idemKey()).send(body);
    expect(res.status).toBe(201);
    expect(res.body.data.user).toMatchObject({ role: 'LAND_OFFICER', phone: '+255713222333', status: 'ACTIVE' });
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
    const pw = res.body.data.temporaryPassword as string;
    expect(outbox.some((m) => m.to === 'neema@lands.go.tz' && m.text.includes(pw))).toBe(true);
    const login = await api().post('/api/v1/auth/login').send({ identifier: 'neema@lands.go.tz', password: pw });
    expect(login.status).toBe(200);

    const dup = await api().post('/api/v1/admin/users').set(bearer(admin.token)).set('Idempotency-Key', idemKey()).send(body);
    expect(dup.body.error.code).toBe('USER_EXISTS');
    const noBank = await api().post('/api/v1/admin/users').set(bearer(admin.token)).set('Idempotency-Key', idemKey()).send({ ...body, role: 'BANK_OFFICER', phone: '0713222334', email: 'b@x.tz' });
    expect(noBank.status).toBe(400);
  });

  it('role changes re-enroll the ledger identity; landowner ⇄ staff and self changes are refused', async () => {
    const admin = await makeUser('SYSTEM_ADMIN');
    const agent = await makeUser('SUPPORT_AGENT');
    const citizen = await makeUser('CITIZEN');
    const patch = (userId: string, body: Record<string, unknown>) => api().patch(`/api/v1/admin/users/${userId}`).set(bearer(admin.token)).set('Idempotency-Key', idemKey()).send(body);

    const r = await patch(agent.user.userId, { role: 'LAND_OFFICER' });
    expect(r.body.data.role).toBe('LAND_OFFICER');
    expect(vi.mocked(forgetIdentity)).toHaveBeenCalledWith(agent.user.userId);
    expect((await patch(citizen.user.userId, { role: 'REGISTRAR' })).body.error.code).toBe('ROLE_CHANGE_NOT_ALLOWED');
    expect((await patch(admin.user.userId, { role: 'REGISTRAR' })).body.error.code).toBe('SELF_ROLE_CHANGE');
    expect(await AuditLog.countDocuments({ action: 'admin.user.roleChange' })).toBe(1);
  });

  it('deactivation blocks sign-in; reactivation restores it', async () => {
    const admin = await makeUser('SYSTEM_ADMIN');
    const staff = await makeUser('REGISTRAR');
    const deact = await api().post(`/api/v1/admin/users/${staff.user.userId}/deactivate`).set(bearer(admin.token)).set('Idempotency-Key', idemKey()).send({ reason: 'Left the ministry' });
    expect(deact.body.data.status).toBe('DEACTIVATED');
    const login = await api().post('/api/v1/auth/login').send({ identifier: staff.user.email, password: 'Milki@2026' });
    expect(login.body.error.code).toBe('ACCOUNT_DEACTIVATED');
    await api().post(`/api/v1/admin/users/${admin.user.userId}/deactivate`).set(bearer(admin.token)).set('Idempotency-Key', idemKey()).send({ reason: 'oops' }).expect(400);
    await api().post(`/api/v1/admin/users/${staff.user.userId}/reactivate`).set(bearer(admin.token)).set('Idempotency-Key', idemKey()).expect(200);
    expect((await User.findOne({ userId: staff.user.userId }).lean())?.status).toBe('ACTIVE');
  });

  it('offices: CRUD, and an office with active staff cannot be deleted', async () => {
    const admin = await makeUser('SYSTEM_ADMIN');
    const o = await api().post('/api/v1/admin/offices').set(bearer(admin.token)).set('Idempotency-Key', idemKey()).send({ code: 'dsm-kin', name: 'Kinondoni Land Office', region: 'Dar es Salaam', district: 'Kinondoni' });
    expect(o.body.data.code).toBe('DSM-KIN');
    const officer = await makeUser('LAND_OFFICER', { officeId: o.body.data._id });
    expect((await api().get('/api/v1/offices').set(bearer(officer.token))).body.data).toHaveLength(1);
    const del = await api().delete(`/api/v1/admin/offices/${o.body.data._id}`).set(bearer(admin.token)).set('Idempotency-Key', idemKey());
    expect(del.body.error.code).toBe('OFFICE_HAS_STAFF');
  });

  it('the audit log is readable by admins only and filterable', async () => {
    const admin = await makeUser('SYSTEM_ADMIN');
    const agent = await makeUser('SUPPORT_AGENT');
    await AuditLog.create([
      { action: 'transfer.approve', actor: { userId: admin.user.userId, role: 'SYSTEM_ADMIN' }, entityType: 'Transfer', entityId: 'TRF-1' },
      { action: 'auth.login', actor: { userId: agent.user.userId, role: 'SUPPORT_AGENT' } },
    ]);
    await api().get('/api/v1/admin/audit').set(bearer(agent.token)).expect(403);
    const r = await api().get('/api/v1/admin/audit?action=transfer.').set(bearer(admin.token));
    expect(r.body.data).toHaveLength(1);
    expect(r.body.data[0]).toMatchObject({ entityId: 'TRF-1', actorName: admin.user.fullName });
  });
});

describe('partner API (banks)', () => {
  async function client(scopes: string[], rateLimitPerMin = 60) {
    const admin = await makeUser('SYSTEM_ADMIN');
    const r = await api().post('/api/v1/admin/api-clients').set(bearer(admin.token)).set('Idempotency-Key', idemKey()).send({ name: 'CRDB core banking', bankCode: 'crdb', bankName: 'CRDB Bank', scopes, rateLimitPerMin });
    expect(r.status).toBe(201);
    return { admin, key: r.body.data.apiKey as string, clientId: r.body.data.client.clientId as string, body: r.body };
  }

  it('the key is shown once and stored hashed; scopes are enforced', async () => {
    const c = await client(['parcels:verify']);
    expect(c.key).toMatch(/^mlk_[a-f0-9]{8}_/);
    const list = await api().get('/api/v1/admin/api-clients').set(bearer(c.admin.token));
    expect(JSON.stringify(list.body)).not.toContain(c.key);
    expect(JSON.stringify(list.body)).not.toContain('keyHash');
    expect(list.body.data[0].keyHint).toMatch(/^mlk_[a-f0-9]{8}_…$/);

    await api().get('/api/v1/partner/parcels/DSM-KIN-12-45').expect(401);
    await api().get('/api/v1/partner/parcels/DSM-KIN-12-45').set('x-api-key', `${c.key.slice(0, -2)}xx`).expect(401);
    evaluate.mockResolvedValueOnce(parcel({ activeEncumbranceIds: ['ENC-1'] })).mockResolvedValueOnce([
      { encumbranceId: 'ENC-1', type: 'MORTGAGE', lenderCode: 'NMB', lenderName: 'NMB Bank', amount: 9, currency: 'TZS', reference: 'secret', status: 'ACTIVE' },
    ]);
    const r = await api().get('/api/v1/partner/parcels/DSM-KIN-12-45').set('x-api-key', c.key);
    expect(r.status).toBe(200);
    expect(r.body.meta.source).toBe('ledger');
    expect(r.body.data.encumbrances[0]).toEqual({ encumbranceId: 'ENC-1', type: 'MORTGAGE', lenderCode: 'NMB', lenderName: 'NMB Bank' }); // another bank's terms stay private
    expect(JSON.stringify(r.body)).not.toContain('ownerNidaHash');
    expect(JSON.stringify(r.body)).not.toContain('usr_x');

    const write = await api().post('/api/v1/partner/parcels/DSM-KIN-12-45/encumbrances').set('x-api-key', c.key).set('Idempotency-Key', idemKey()).send({ type: 'MORTGAGE', amount: 1, reference: 'L1' });
    expect(write.body.error.code).toBe('SCOPE_REQUIRED');
  });

  it('verify-owner compares the NIDA hash with the ledger and answers yes/no only', async () => {
    const c = await client(['parcels:verify']);
    evaluate.mockResolvedValue(parcel());
    const yes = await api().post('/api/v1/partner/parcels/DSM-KIN-12-45/verify-owner').set('x-api-key', c.key).send({ nida: '19900101-12345-00001-01' });
    expect(yes.body.data).toMatchObject({ ownerMatches: true, parcelId: 'DSM-KIN-12-45' });
    const no = await api().post('/api/v1/partner/parcels/DSM-KIN-12-45/verify-owner').set('x-api-key', c.key).send({ nida: '19900101123450000999' });
    expect(no.body.data.ownerMatches).toBe(false);
    const audits = await AuditLog.find({ action: /^partner\./ }).lean();
    expect(audits).toHaveLength(2);
    expect(JSON.stringify(audits)).not.toContain('19900101');
  });

  it('writes are signed by the client bank identity; rotate and revoke cut old keys off', async () => {
    const c = await client(['parcels:verify', 'encumbrances:write']);
    submit.mockResolvedValueOnce({ txId: 'tx-p', result: { encumbranceId: 'ENC-00000000000000AA', parcelId: 'DSM-KIN-12-45', type: 'CHARGE' } } as never);
    const add = await api().post('/api/v1/partner/parcels/DSM-KIN-12-45/encumbrances').set('x-api-key', c.key).set('Idempotency-Key', idemKey()).send({ type: 'CHARGE', amount: 5_000_000, reference: 'CRDB/C/9' });
    expect(add.status).toBe(202);
    expect(submit.mock.calls[0]![0]).toEqual({ userId: `api_${c.clientId}`, role: 'BANK_OFFICER', bankCode: 'CRDB' });
    expect(JSON.parse(submit.mock.calls[0]![2][1]!).lenderName).toBe('CRDB Bank');

    const rot = await api().post(`/api/v1/admin/api-clients/${c.clientId}/rotate`).set(bearer(c.admin.token)).set('Idempotency-Key', idemKey());
    const newKey = rot.body.data.apiKey as string;
    expect(newKey).not.toBe(c.key);
    evaluate.mockImplementation((async (_who: unknown, fn: string) => (fn === 'GetEncumbrances' ? [] : parcel())) as never);
    await api().get('/api/v1/partner/parcels/DSM-KIN-12-45').set('x-api-key', c.key).expect(401);
    await api().get('/api/v1/partner/parcels/DSM-KIN-12-45').set('x-api-key', newKey).expect(200);

    await api().post(`/api/v1/admin/api-clients/${c.clientId}/revoke`).set(bearer(c.admin.token)).set('Idempotency-Key', idemKey()).send({ reason: 'Contract ended' }).expect(200);
    const revoked = await api().get('/api/v1/partner/parcels/DSM-KIN-12-45').set('x-api-key', newKey);
    expect(revoked.body.error.code).toBe('API_KEY_REVOKED');
    expect(await AuditLog.countDocuments({ action: 'partner.denied' })).toBe(2);
  });

  it('applies the per-client rate limit', async () => {
    const c = await client(['parcels:verify'], 2);
    evaluate.mockImplementation((async (_who: unknown, fn: string) => (fn === 'GetEncumbrances' ? [] : parcel())) as never);
    await api().get('/api/v1/partner/parcels/DSM-KIN-12-45').set('x-api-key', c.key).expect(200);
    const codes: number[] = [];
    for (let i = 0; i < 2; i++) codes.push((await api().post('/api/v1/partner/parcels/DSM-KIN-12-45/verify-owner').set('x-api-key', c.key).send({ nida: '19900101123450000101' })).status);
    expect(codes).toEqual([200, 429]);
  });
});
