import { describe, expect, it, vi } from 'vitest';
import { ledger } from '../src/core/fabric/ledger';
import { ReauthDevice } from '../src/modules/auth/reauth-device.model';
import { AuditLog } from '../src/modules/audit/audit.model';
import { PASSWORD, api, makeUser } from './helpers';

const evaluate = vi.mocked(ledger.evaluate);

describe('biometric device re-authentication', () => {
  it('enroll with password → reauth with the device secret → revoke', async () => {
    const u = await makeUser('CITIZEN');
    const auth = { Authorization: `Bearer ${u.token}` };
    const bad = await api().post('/api/v1/auth/reauth/device').set(auth).send({ deviceId: 'pixel-8-abc123', password: 'wrong' });
    expect(bad.status).toBe(401);

    const enroll = await api().post('/api/v1/auth/reauth/device').set(auth).send({ deviceId: 'pixel-8-abc123', deviceName: 'Pixel 8', password: PASSWORD });
    expect(enroll.status).toBe(200);
    const secret = enroll.body.data.deviceSecret as string;
    expect(secret.length).toBeGreaterThanOrEqual(32);
    const stored = await ReauthDevice.findOne({ deviceId: 'pixel-8-abc123' }).lean();
    expect(stored?.secretHash).not.toBe(secret); // only the hash is stored

    const ok = await api().post('/api/v1/auth/reauth').set(auth).send({ deviceId: 'pixel-8-abc123', deviceSecret: secret });
    expect(ok.status).toBe(200);
    expect(ok.body.data.reauthToken).toBeTruthy();

    const wrong = await api().post('/api/v1/auth/reauth').set(auth).send({ deviceId: 'pixel-8-abc123', deviceSecret: 'x'.repeat(43) });
    expect(wrong.body.error.code).toBe('DEVICE_NOT_TRUSTED');

    await api().delete('/api/v1/auth/reauth/device/pixel-8-abc123').set(auth).expect(200);
    const after = await api().post('/api/v1/auth/reauth').set(auth).send({ deviceId: 'pixel-8-abc123', deviceSecret: secret });
    expect(after.status).toBe(401);
    expect(await AuditLog.countDocuments({ action: /^auth\.reauthDevice/ })).toBe(3);
  });

  it("a device secret only works for the user who enrolled it", async () => {
    const a = await makeUser('CITIZEN');
    const b = await makeUser('CITIZEN');
    const enroll = await api().post('/api/v1/auth/reauth/device').set('Authorization', `Bearer ${a.token}`).send({ deviceId: 'shared-phone-01', password: PASSWORD });
    const res = await api().post('/api/v1/auth/reauth').set('Authorization', `Bearer ${b.token}`).send({ deviceId: 'shared-phone-01', deviceSecret: enroll.body.data.deviceSecret });
    expect(res.status).toBe(401);
  });
});

describe('public verification', () => {
  it('parcel: no sign-in, read from the ledger, minimal data', async () => {
    const owner = await makeUser('CITIZEN', { fullName: 'Juma Hassan' });
    evaluate.mockResolvedValueOnce({
      parcelId: 'DSM-KIN-12-45', titleNumber: 'T-1', region: 'Dar es Salaam', district: 'Kinondoni', ward: 'Mikocheni', area: 500, landUse: 'RESIDENTIAL',
      status: 'ENCUMBERED', ownerId: owner.user.userId, ownerNidaHash: 'secret', ownershipVersion: 2, activeEncumbranceIds: ['ENC-1'], openDisputeIds: [],
      frozen: false, activeTransferId: null, lastTxId: 'tx', updatedAt: '2026-01-01T00:00:00Z',
    });
    const res = await api().get('/api/v1/verify/parcels/dsm-kin-12-45');
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ parcelId: 'DSM-KIN-12-45', owner: 'Juma H.', encumbered: true, status: 'ENCUMBERED' });
    expect(JSON.stringify(res.body)).not.toContain('secret');
    expect(JSON.stringify(res.body)).not.toContain(owner.user.phone);
    expect(evaluate).toHaveBeenCalledWith('service', 'GetParcel', ['DSM-KIN-12-45']);
  });

  it('document: hash check against the ledger', async () => {
    evaluate.mockResolvedValueOnce({ documentId: 'DOC-0123456789ABCDEF', match: true, status: 'ACTIVE', version: 1, latestDocumentId: null, parcelId: 'DSM-KIN-12-45', documentType: 'TITLE_DEED' });
    const sha = 'a'.repeat(64);
    const res = await api().get(`/api/v1/verify/documents/DOC-0123456789ABCDEF?sha256=${sha}`);
    expect(res.body.data).toMatchObject({ match: true, sha256: sha });
    expect(evaluate).toHaveBeenCalledWith('service', 'VerifyDocument', ['DOC-0123456789ABCDEF', sha]);
    expect((await api().get('/api/v1/verify/documents/DOC-0123456789ABCDEF?sha256=nope')).status).toBe(400);
  });
});
