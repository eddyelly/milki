import { describe, expect, it, vi } from 'vitest';
import { ledger } from '../src/core/fabric/ledger';
import { ParcelCache } from '../src/modules/parcels/parcel-cache.model';
import { TransferCache } from '../src/modules/transfers/transfer-cache.model';
import { api, idemKey, makeUser, reauth } from './helpers';

const submit = vi.mocked(ledger.submit);
const TX = '9'.repeat(64);

async function t3(token: string, path: string, body: object) {
  return api().post(`/api/v1${path}`).set('Authorization', `Bearer ${token}`).set('Idempotency-Key', idemKey()).set('X-Reauth-Token', await reauth(token)).send(body);
}

describe('disputes API', () => {
  it('officer flags; officer/registrar add notes and resolve; others refused', async () => {
    const officer = await makeUser('LAND_OFFICER');
    const registrar = await makeUser('REGISTRAR');
    submit.mockResolvedValue({ txId: TX, result: { disputeId: 'DSP-0123456789ABCDEF', parcelId: 'DSM-KIN-12-45', status: 'OPEN' } });

    const flag = await t3(officer.token, '/parcels/dsm-kin-12-45/disputes', { category: 'BOUNDARY', summary: 'Neighbour contests the eastern beacon.' });
    expect(flag.status).toBe(202);
    expect(flag.body.data).toMatchObject({ disputeId: 'DSP-0123456789ABCDEF', parcelId: 'DSM-KIN-12-45' });
    expect((await t3(officer.token, '/disputes/DSP-0123456789ABCDEF/notes', { note: 'Site visit Monday' })).status).toBe(202);
    expect((await t3(registrar.token, '/disputes/DSP-0123456789ABCDEF/resolve', { resolution: 'Beacon confirmed by resurvey' })).status).toBe(202);
    expect(submit.mock.calls.map((c) => [c[1], c[2]])).toEqual([
      ['FlagDispute', ['DSM-KIN-12-45', JSON.stringify({ category: 'BOUNDARY', summary: 'Neighbour contests the eastern beacon.' })]],
      ['AddDisputeNote', ['DSP-0123456789ABCDEF', 'Site visit Monday']],
      ['ResolveDispute', ['DSP-0123456789ABCDEF', 'Beacon confirmed by resurvey']],
    ]);

    submit.mockClear();
    expect((await t3(registrar.token, '/parcels/DSM-KIN-12-45/disputes', { category: 'FRAUD', summary: 'Two agreements for one plot.' })).status).toBe(403);
    const citizen = await makeUser('CITIZEN');
    expect((await t3(citizen.token, '/disputes/DSP-0123456789ABCDEF/resolve', { resolution: 'mine' })).status).toBe(403);
    expect((await t3(officer.token, '/parcels/DSM-KIN-12-45/disputes', { category: 'FRAUD', summary: 'short' })).status).toBe(400);
    expect(submit).not.toHaveBeenCalled();
  });
});

describe('GET /stats/overview', () => {
  it('aggregates the caches for staff and is hidden from citizens', async () => {
    const officer = await makeUser('LAND_OFFICER');
    await ParcelCache.insertMany([
      { parcelId: 'A-A-1-1', region: 'Dar es Salaam', status: 'ACTIVE' },
      { parcelId: 'A-A-1-2', region: 'Dar es Salaam', status: 'ENCUMBERED' },
      { parcelId: 'A-A-1-3', region: 'Arusha', status: 'ACTIVE' },
    ]);
    await TransferCache.insertMany([
      { transferId: 'TRF-1', parcelId: 'A-A-1-1', sellerId: 's', buyerId: 'b', status: 'COMPLETED', ledgerCreatedAt: new Date() },
      { transferId: 'TRF-2', parcelId: 'A-A-1-2', sellerId: 's', buyerId: 'b', status: 'OFFICER_VERIFIED', ledgerCreatedAt: new Date() },
    ]);
    const res = await api().get('/api/v1/stats/overview').set('Authorization', `Bearer ${officer.token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.parcels).toMatchObject({ total: 3, byStatus: { ACTIVE: 2, ENCUMBERED: 1 } });
    expect(res.body.data.parcels.byRegion[0]).toEqual({ region: 'Dar es Salaam', count: 2 });
    expect(res.body.data.queues).toEqual({ awaitingPayments: 0, awaitingVerification: 0, awaitingApproval: 1 });
    expect(res.body.data.transfers.monthly).toHaveLength(6);
    expect(res.body.data.transfers.monthly.at(-1)).toMatchObject({ started: 2, completed: 1 });
    expect((await api().get('/api/v1/stats/overview').set('Authorization', `Bearer ${officer.token}`)).body.meta.cached).toBe(true);
    const citizen = await makeUser('CITIZEN');
    expect((await api().get('/api/v1/stats/overview').set('Authorization', `Bearer ${citizen.token}`)).status).toBe(403);
  });
});
