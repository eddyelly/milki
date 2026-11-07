import { describe, expect, it, vi } from 'vitest';
import { piiHash, seal, unseal } from '../src/core/crypto';
import { mapLedgerError } from '../src/core/fabric/ledger';
import { LedgerTx } from '../src/core/fabric/ledger-tx.model';
import { api, makeUser } from './helpers';

describe('crypto', () => {
  it('AES-256-GCM round-trips and detects tampering or a wrong owner (AAD)', () => {
    const sealed = seal('-----BEGIN PRIVATE KEY-----abc', 'milki-wallet:usr_a');
    expect(sealed.ct).not.toContain('PRIVATE');
    expect(unseal(sealed, 'milki-wallet:usr_a')).toBe('-----BEGIN PRIVATE KEY-----abc');
    expect(() => unseal(sealed, 'milki-wallet:usr_b')).toThrow();
    const flipped = { ...sealed, ct: Buffer.from(Buffer.from(sealed.ct, 'base64').map((b, i) => (i === 0 ? b ^ 1 : b))).toString('base64') };
    expect(() => unseal(flipped, 'milki-wallet:usr_a')).toThrow();
  });

  it('piiHash is a stable, salted 64-hex digest', () => {
    expect(piiHash('19900101123450000101')).toMatch(/^[a-f0-9]{64}$/);
    expect(piiHash('19900101123450000101')).toBe(piiHash('19900101123450000101'));
    expect(piiHash('a')).not.toBe(piiHash('b'));
  });
});

describe('mapLedgerError', () => {
  const chaincodeErr = (json: object, viaDetails = true) =>
    Object.assign(new Error(viaDetails ? '10 ABORTED: failed to endorse transaction' : `chaincode response 500, ${JSON.stringify(json)}`), {
      code: 10,
      details: viaDetails ? [{ address: 'peer0', mspId: 'Org1MSP', message: `chaincode response 500, ${JSON.stringify(json)} trailing` }] : [],
    });

  it('turns chaincode JSON errors into readable API errors with the right HTTP status', () => {
    const e = mapLedgerError(chaincodeErr({ code: 'PARCEL_ENCUMBERED', message: 'This parcel has an active mortgage with CRDB Bank.', details: { parcelId: 'X' } }));
    expect(e).toMatchObject({ status: 409, code: 'PARCEL_ENCUMBERED', message: 'This parcel has an active mortgage with CRDB Bank.', details: { parcelId: 'X' } });
    expect(mapLedgerError(chaincodeErr({ code: 'FORBIDDEN', message: 'Only a registrar can register parcels.' }, false))).toMatchObject({ status: 403 });
    expect(mapLedgerError(chaincodeErr({ code: 'NOT_FOUND', message: 'nope' }))).toMatchObject({ status: 404 });
    expect(mapLedgerError(chaincodeErr({ code: 'INVALID_ARGUMENT', message: 'bad' }))).toMatchObject({ status: 400 });
  });

  it('reports an unreachable network as 503 and anything else as 502', () => {
    expect(mapLedgerError(Object.assign(new Error('14 UNAVAILABLE: No connection established'), { code: 14 }))).toMatchObject({ status: 503, code: 'LEDGER_UNAVAILABLE' });
    expect(mapLedgerError(Object.assign(new Error('4 DEADLINE_EXCEEDED'), { code: 4 }))).toMatchObject({ status: 503 });
    expect(mapLedgerError(new Error('weird {"code": broken'))).toMatchObject({ status: 502, code: 'LEDGER_ERROR' });
  });
});

describe('GET /ledger/tx/:txId', () => {
  it('returns the tracked status to its submitter and to staff, not to other citizens', async () => {
    const a = await makeUser('CITIZEN');
    const b = await makeUser('CITIZEN');
    const staff = await makeUser('SUPPORT_AGENT');
    const txId = 'b'.repeat(64);
    await LedgerTx.create({ txId, userId: a.user.userId, fn: 'InitiateTransfer', status: 'COMMITTED', blockNumber: 42 });
    const mine = await api().get(`/api/v1/ledger/tx/${txId}`).set('Authorization', `Bearer ${a.token}`);
    expect(mine.body.data).toMatchObject({ txId, status: 'COMMITTED', blockNumber: 42 });
    expect((await api().get(`/api/v1/ledger/tx/${txId}`).set('Authorization', `Bearer ${b.token}`)).status).toBe(403);
    expect((await api().get(`/api/v1/ledger/tx/${txId}`).set('Authorization', `Bearer ${staff.token}`)).status).toBe(200);
    expect((await api().get(`/api/v1/ledger/tx/${'c'.repeat(64)}`).set('Authorization', `Bearer ${a.token}`)).status).toBe(404);
  });
});

describe('app plumbing', () => {
  it('unknown routes use the error envelope; responses carry a request ID; security headers are set', async () => {
    const res = await api().get('/api/v1/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ROUTE_NOT_FOUND');
    expect(res.headers['x-request-id']).toBeTruthy();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('serves the OpenAPI document', async () => {
    const res = await api().get('/api/docs/openapi.json');
    expect(res.status).toBe(200);
    expect(res.body.paths).toHaveProperty('/parcels');
  });

  it('health reports each dependency', async () => {
    const { ledger } = await import('../src/core/fabric/ledger');
    vi.mocked(ledger.evaluate).mockResolvedValueOnce({ name: 'land-registry', version: '1.0.0' });
    const res = await api().get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: 'ok', mongo: { ok: true }, redis: { ok: true }, ledger: { ok: true, detail: 'land-registry@1.0.0' } });
    vi.mocked(ledger.evaluate).mockRejectedValueOnce(new Error('down'));
    expect((await api().get('/api/v1/health')).status).toBe(503);
  });
});
