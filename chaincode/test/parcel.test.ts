import { expect } from 'chai';
import type { Page } from '../src/ledger';
import type { Parcel } from '../src/models';
import { ID, PARCEL_ID, Harness, expectError, parcelInput } from './support/harness';

describe('Parcel', () => {
  let h: Harness;
  beforeEach(() => {
    h = new Harness();
  });

  describe('RegisterParcel', () => {
    it('registers an ACTIVE parcel with tx-derived audit fields and emits milki.Parcel.Registered', async () => {
      const p = await h.register();
      expect(p).to.include({ parcelId: PARCEL_ID, status: 'ACTIVE', ownerId: ID.seller.id, ownershipVersion: 1, frozen: false, retired: false });
      expect(p.createdAt).to.equal('2026-01-01T00:01:00.250Z');
      expect(p.createdBy).to.deep.equal({ id: 'registrar1', mspId: 'Org1MSP', role: 'REGISTRAR' });
      expect(h.ledger.json<{ parcelId: string }>('TITLE_DSM/KIN/2026/0045')).to.include({ parcelId: PARCEL_ID });

      const ev = h.ledger.lastEvent();
      expect(ev?.name).to.equal('milki.Parcel.Registered');
      expect(ev?.payload).to.include({ entity: 'Parcel', action: 'Registered', id: PARCEL_ID, status: 'ACTIVE' });
      expect(JSON.stringify(ev?.payload)).not.to.include(p.ownerNidaHash); // rule 4: no NIDA hash in events
    });

    it('accepts a survey boundary', async () => {
      const boundary = [[39.2461, -6.763], [39.2463, -6.763], [39.2463, -6.7632], [39.2461, -6.7632]];
      const p = await h.register({ location: { latitude: -6.7631, longitude: 39.2462, boundary } });
      expect(p.location.boundary).to.deep.equal(boundary);
      expect(p.location.address).to.equal(null);
    });

    for (const [name, who] of [
      ['a land officer', ID.officer],
      ['a citizen', ID.seller],
      ['a support agent', ID.support],
      ['a bank officer', ID.crdb],
      ['an identity without a role', ID.peerAdmin],
    ] as const) {
      it(`refuses ${name}`, async () => {
        await expectError(h.call(who, 'RegisterParcel', [JSON.stringify(parcelInput())]), 'FORBIDDEN', 'Only a registrar');
      });
    }

    it('refuses a REGISTRAR certificate issued by the bank CA', async () => {
      await expectError(h.call(ID.forgedRegistrar, 'RegisterParcel', [JSON.stringify(parcelInput())]), 'FORBIDDEN', 'right organisation');
    });

    it('rejects a duplicate parcel ID and a duplicate title number', async () => {
      await h.register();
      await expectError(h.register(), 'CONFLICT', 'already registered');
      await expectError(h.register({ parcelId: 'DSM-KIN-12-46' }), 'CONFLICT', `registered to parcel ${PARCEL_ID}`);
    });

    const invalidCases: [string, Record<string, unknown>, string][] = [
      ['a malformed parcel ID', { parcelId: 'dsm kin 12' }, 'parcelId'],
      ['an unknown field', { salePrice: 10 }, 'salePrice'],
      ['a NIDA hash that is not SHA-256', { ownerNidaHash: '1990-0101' }, 'ownerNidaHash'],
      ['a zero area', { area: 0 }, 'area'],
      ['a non-numeric area', { area: '650' }, 'area'],
      ['an unknown land use', { landUse: 'CASINO' }, 'landUse'],
      ['a missing title number', { titleNumber: '' }, 'titleNumber'],
      ['an over-long ward', { ward: 'x'.repeat(81) }, 'ward'],
      ['a latitude out of range', { location: { latitude: -100, longitude: 39 } }, 'latitude'],
      ['a missing location', { location: null }, 'location'],
      ['an array as location', { location: [1, 2] }, 'location'],
      ['an unknown location field', { location: { latitude: -6, longitude: 39, owner: 'x' } }, 'owner'],
      ['a boundary with two points', { location: { latitude: -6, longitude: 39, boundary: [[39, -6], [39.1, -6]] } }, 'boundary'],
      ['a malformed boundary point', { location: { latitude: -6, longitude: 39, boundary: [[39, -6], [39.1], [39.2, -6.1]] } }, 'boundary[1]'],
      ['a bad owner ID', { ownerId: 'a b' }, 'ownerId'],
    ];
    for (const [name, overrides, field] of invalidCases) {
      it(`rejects ${name}`, async () => {
        await expectError(h.register(overrides), 'INVALID_ARGUMENT', field);
      });
    }

    it('rejects non-JSON and non-object input', async () => {
      await expectError(h.call(ID.registrar, 'RegisterParcel', ['{oops']), 'INVALID_ARGUMENT', 'not valid JSON');
      await expectError(h.call(ID.registrar, 'RegisterParcel', ['[1,2]']), 'INVALID_ARGUMENT', 'JSON object');
    });

    it('is atomic: a failed registration leaves no state behind', async () => {
      await expectError(h.register({ landUse: 'CASINO' }), 'INVALID_ARGUMENT');
      expect(h.ledger.state.size).to.equal(0);
      expect(h.ledger.events).to.have.length(0);
    });
  });

  describe('GetParcel / GetParcelHistory / QueryParcels', () => {
    it('returns NOT_FOUND for an unknown parcel and lets any identity read', async () => {
      await expectError(h.call(ID.peerAdmin, 'GetParcel', ['DSM-KIN-99-99']), 'NOT_FOUND', 'not registered');
      await h.register();
      const p = await h.call<Parcel>(ID.peerAdmin, 'GetParcel', [PARCEL_ID]);
      expect(p.parcelId).to.equal(PARCEL_ID);
    });

    it('returns history oldest-first even though the peer yields newest-first', async () => {
      await h.register();
      await h.call(ID.registrar, 'UpdateParcel', [PARCEL_ID, JSON.stringify({ landUse: 'COMMERCIAL' })]);
      const hist = await h.call<{ txId: string; timestamp: string; parcel: Parcel }[]>(ID.support, 'GetParcelHistory', [PARCEL_ID]);
      expect(hist.map((e) => e.parcel.landUse)).to.deep.equal(['RESIDENTIAL', 'COMMERCIAL']);
      expect((hist[0]?.timestamp ?? '') < (hist[1]?.timestamp ?? '')).to.equal(true);
      await expectError(h.call(ID.support, 'GetParcelHistory', ['DSM-KIN-99-99']), 'NOT_FOUND');
    });

    it('queries by owner with pagination, forcing docType', async () => {
      await h.register();
      await h.register({ parcelId: 'DSM-KIN-12-46', titleNumber: 'T-46' });
      await h.register({ parcelId: 'DSM-KIN-12-47', titleNumber: 'T-47', ownerId: ID.stranger.id });

      const q = JSON.stringify({ selector: { ownerId: ID.seller.id, docType: 'transfer' }, sort: [{ parcelId: 'desc' }] });
      const page1 = await h.call<Page<Parcel>>(ID.support, 'QueryParcels', [q, '1', '']);
      expect(page1.records.map((p) => p.parcelId)).to.deep.equal(['DSM-KIN-12-46']);
      expect(page1.bookmark).to.not.equal('');
      const page2 = await h.call<Page<Parcel>>(ID.support, 'QueryParcels', [q, '1', page1.bookmark]);
      expect(page2.records.map((p) => p.parcelId)).to.deep.equal([PARCEL_ID]);
      expect(page2.bookmark).to.equal('');

      const all = await h.call<Page<Parcel>>(ID.support, 'QueryParcels', ['', '', '']);
      expect(all.fetchedRecordsCount).to.equal(3);
    });

    const badQueries: [string, string, string][] = [
      ['a non-object selector', JSON.stringify({ selector: [1] }), 'selector'],
      ['an unknown query key', JSON.stringify({ limit: 5 }), 'limit'],
      ['a non-array sort', JSON.stringify({ sort: { a: 'asc' } }), 'sort'],
      ['a multi-field sort entry', JSON.stringify({ sort: [{ a: 'asc', b: 'desc' }] }), 'exactly one field'],
      ['a bad sort direction', JSON.stringify({ sort: [{ a: 'up' }] }), 'asc'],
    ];
    for (const [name, q, part] of badQueries) {
      it(`rejects ${name}`, async () => {
        await expectError(h.call(ID.support, 'QueryParcels', [q, '10', '']), 'INVALID_ARGUMENT', part);
      });
    }

    it('rejects page sizes outside 1–100', async () => {
      await expectError(h.call(ID.support, 'QueryParcels', ['{}', '0', '']), 'INVALID_ARGUMENT', 'pageSize');
      await expectError(h.call(ID.support, 'QueryParcels', ['{}', '101', '']), 'INVALID_ARGUMENT', 'pageSize');
      await expectError(h.call(ID.support, 'QueryParcels', ['{}', '2.5', '']), 'INVALID_ARGUMENT', 'pageSize');
    });
  });

  describe('UpdateParcel', () => {
    beforeEach(async () => {
      await h.register();
    });

    it('updates the whitelisted fields and records the correction reason', async () => {
      const p = await h.call<Parcel>(ID.registrar, 'UpdateParcel', [
        PARCEL_ID,
        JSON.stringify({ landUse: 'MIXED_USE', area: 640, areaCorrectionReason: 'Resurvey 2026', location: { latitude: -6.77, longitude: 39.25 } }),
      ]);
      expect(p).to.include({ landUse: 'MIXED_USE', area: 640, lastChangeNote: 'Resurvey 2026' });
      expect(p.location.latitude).to.equal(-6.77);
      expect(h.ledger.lastEvent()?.payload).to.deep.include({ action: 'Updated', data: { fields: 'landUse,area,location' } });
    });

    it('refuses ownership and other non-whitelisted fields', async () => {
      await expectError(h.call(ID.registrar, 'UpdateParcel', [PARCEL_ID, JSON.stringify({ ownerId: 'usr_x' })]), 'INVALID_ARGUMENT', 'ownerId');
    });

    it('requires a reason for an area correction, and only with an area', async () => {
      await expectError(h.call(ID.registrar, 'UpdateParcel', [PARCEL_ID, JSON.stringify({ area: 600 })]), 'INVALID_ARGUMENT', 'areaCorrectionReason');
      await expectError(
        h.call(ID.registrar, 'UpdateParcel', [PARCEL_ID, JSON.stringify({ areaCorrectionReason: 'why' })]),
        'INVALID_ARGUMENT',
        'only accepted together',
      );
    });

    it('rejects an empty update, non-registrars and retired parcels', async () => {
      await expectError(h.call(ID.registrar, 'UpdateParcel', [PARCEL_ID, '{}']), 'INVALID_ARGUMENT', 'Nothing to update');
      await expectError(h.call(ID.officer, 'UpdateParcel', [PARCEL_ID, JSON.stringify({ landUse: 'COMMERCIAL' })]), 'FORBIDDEN');
      await h.call(ID.registrar, 'RetireParcel', [PARCEL_ID, 'Merged into new survey']);
      await expectError(h.call(ID.registrar, 'UpdateParcel', [PARCEL_ID, JSON.stringify({ landUse: 'COMMERCIAL' })]), 'PARCEL_RETIRED');
    });
  });

  describe('FreezeParcel / UnfreezeParcel', () => {
    beforeEach(async () => {
      await h.register();
    });

    it('freezes and unfreezes with reasons and events', async () => {
      let p = await h.call<Parcel>(ID.registrar, 'FreezeParcel', [PARCEL_ID, 'Court injunction 12/2026']);
      expect(p).to.include({ status: 'FROZEN', frozen: true, frozenReason: 'Court injunction 12/2026' });
      expect(h.ledger.lastEvent()?.name).to.equal('milki.Parcel.Frozen');
      p = await h.call<Parcel>(ID.registrar, 'UnfreezeParcel', [PARCEL_ID, 'Injunction lifted']);
      expect(p).to.include({ status: 'ACTIVE', frozen: false, frozenReason: null, lastChangeNote: 'Injunction lifted' });
      expect(h.ledger.lastEvent()?.name).to.equal('milki.Parcel.Unfrozen');
    });

    it('rejects double freeze, unfreezing an unfrozen parcel, missing reasons and non-registrars', async () => {
      await h.call(ID.registrar, 'FreezeParcel', [PARCEL_ID, 'Investigation']);
      await expectError(h.call(ID.registrar, 'FreezeParcel', [PARCEL_ID, 'Again']), 'INVALID_STATE', 'already frozen');
      await h.call(ID.registrar, 'UnfreezeParcel', [PARCEL_ID, 'Done']);
      await expectError(h.call(ID.registrar, 'UnfreezeParcel', [PARCEL_ID, 'Done']), 'INVALID_STATE', 'not frozen');
      await expectError(h.call(ID.registrar, 'FreezeParcel', [PARCEL_ID, '']), 'INVALID_ARGUMENT', 'reason');
      await expectError(h.call(ID.officer, 'FreezeParcel', [PARCEL_ID, 'Investigation']), 'FORBIDDEN');
      await expectError(h.call(ID.officer, 'UnfreezeParcel', [PARCEL_ID, 'Investigation']), 'FORBIDDEN');
    });

    it('keeps underlying facts: FROZEN wins over ENCUMBERED, and ENCUMBERED returns on unfreeze', async () => {
      await h.addMortgage();
      await h.call(ID.registrar, 'FreezeParcel', [PARCEL_ID, 'Investigation']);
      expect(h.parcel().status).to.equal('FROZEN');
      await h.call(ID.registrar, 'UnfreezeParcel', [PARCEL_ID, 'Cleared']);
      expect(h.parcel().status).to.equal('ENCUMBERED');
    });

    it('cannot freeze or unfreeze a retired parcel', async () => {
      await h.call(ID.registrar, 'RetireParcel', [PARCEL_ID, 'Merged']);
      await expectError(h.call(ID.registrar, 'FreezeParcel', [PARCEL_ID, 'x reason']), 'PARCEL_RETIRED');
      await expectError(h.call(ID.registrar, 'UnfreezeParcel', [PARCEL_ID, 'x reason']), 'PARCEL_RETIRED');
    });
  });

  describe('RetireParcel', () => {
    beforeEach(async () => {
      await h.register();
    });

    it('retires (never deletes) the parcel', async () => {
      const p = await h.call<Parcel>(ID.registrar, 'RetireParcel', [PARCEL_ID, 'Merged into DSM-KIN-12-50']);
      expect(p).to.include({ status: 'RETIRED', retired: true, retiredReason: 'Merged into DSM-KIN-12-50' });
      expect(h.ledger.state.has(`PARCEL_${PARCEL_ID}`)).to.equal(true);
      await expectError(h.call(ID.registrar, 'RetireParcel', [PARCEL_ID, 'Again']), 'INVALID_STATE', 'already retired');
    });

    it('refuses while a transfer, an encumbrance or a dispute is active', async () => {
      const t = await h.initiate();
      await expectError(h.call(ID.registrar, 'RetireParcel', [PARCEL_ID, 'Merge']), 'TRANSFER_IN_PROGRESS');
      await h.call(ID.seller, 'CancelTransfer', [t.transferId, 'Changed my mind']);

      const enc = await h.addMortgage();
      await expectError(h.call(ID.registrar, 'RetireParcel', [PARCEL_ID, 'Merge']), 'PARCEL_ENCUMBERED');
      await h.call(ID.crdb, 'ReleaseEncumbrance', [enc.encumbranceId, 'Loan repaid']);

      await h.flagDispute();
      await expectError(h.call(ID.registrar, 'RetireParcel', [PARCEL_ID, 'Merge']), 'PARCEL_DISPUTED');
    });

    it('refuses non-registrars', async () => {
      await expectError(h.call(ID.officer, 'RetireParcel', [PARCEL_ID, 'Merge']), 'FORBIDDEN');
    });
  });
});
