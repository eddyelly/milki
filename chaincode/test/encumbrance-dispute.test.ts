import { expect } from 'chai';
import type { Dispute, Encumbrance } from '../src/models';
import { Harness, ID, PARCEL_ID, expectError, hash } from './support/harness';

describe('Encumbrance', () => {
  let h: Harness;
  beforeEach(async () => {
    h = new Harness();
    await h.register();
  });

  it('a bank officer adds a mortgage; lender code comes from the certificate', async () => {
    const enc = await h.addMortgage(ID.crdb, PARCEL_ID, { termsHash: hash('terms.pdf') });
    expect(enc).to.include({ status: 'ACTIVE', type: 'MORTGAGE', lenderCode: 'CRDB', lenderName: 'CRDB Bank', amount: 90_000_000, termsHash: hash('terms.pdf') });
    expect(enc.encumbranceId).to.match(/^ENC-/);
    expect(h.parcel()).to.deep.include({ status: 'ENCUMBERED', activeEncumbranceIds: [enc.encumbranceId], encumbranceIds: [enc.encumbranceId] });
    expect(h.ledger.lastEvent()?.name).to.equal('milki.Encumbrance.Added');
  });

  it('only bank officers linked to a bank can add', async () => {
    await expectError(h.addMortgage(ID.registrar), 'FORBIDDEN', 'bank officer');
    await expectError(h.addMortgage(ID.bankNoCode), 'FORBIDDEN', 'not linked to a bank');
  });

  const bad: [string, Record<string, unknown>, string][] = [
    ['type', { type: 'LOAN' }, 'type'],
    ['amount', { amount: 0 }, 'amount'],
    ['currency', { currency: 'tzs' }, 'currency'],
    ['termsHash', { termsHash: 'abc' }, 'termsHash'],
    ['reference', { reference: '' }, 'reference'],
    ['extra field', { borrowerNida: 'x' }, 'borrowerNida'],
  ];
  for (const [name, overrides, part] of bad) {
    it(`validates ${name}`, async () => {
      await expectError(h.addMortgage(ID.crdb, PARCEL_ID, overrides), 'INVALID_ARGUMENT', part);
    });
  }

  it('is refused on frozen, retired, disputed parcels and during a transfer', async () => {
    const t = await h.initiate();
    await expectError(h.addMortgage(), 'TRANSFER_IN_PROGRESS', 'cannot be encumbered');
    await h.call(ID.seller, 'CancelTransfer', [t.transferId, 'Withdrawn']);

    const d = await h.flagDispute();
    await expectError(h.addMortgage(), 'PARCEL_DISPUTED');
    await h.call(ID.officer, 'ResolveDispute', [d.disputeId, 'Settled']);

    await h.call(ID.registrar, 'FreezeParcel', [PARCEL_ID, 'Investigation']);
    await expectError(h.addMortgage(), 'PARCEL_FROZEN');
    await h.call(ID.registrar, 'UnfreezeParcel', [PARCEL_ID, 'Cleared']);

    await h.call(ID.registrar, 'RetireParcel', [PARCEL_ID, 'Merged']);
    await expectError(h.addMortgage(), 'PARCEL_RETIRED');
  });

  it('the owning bank updates amount/terms and every change is recorded', async () => {
    const enc = await h.addMortgage();
    const up = await h.call<Encumbrance>(ID.crdb, 'UpdateEncumbrance', [
      enc.encumbranceId,
      JSON.stringify({ amount: 75_000_000, currency: 'USD', reference: 'LN-2026-77B', termsHash: hash('terms-v2.pdf') }),
    ]);
    expect(up).to.include({ amount: 75_000_000, currency: 'USD', reference: 'LN-2026-77B' });
    expect(up.changes).to.have.length(1);
    expect(up.changes[0]?.changes.map((c) => c.field)).to.deep.equal(['amount', 'currency', 'reference', 'termsHash']);
    expect(h.ledger.lastEvent()?.name).to.equal('milki.Encumbrance.Updated');

    const cleared = await h.call<Encumbrance>(ID.crdb, 'UpdateEncumbrance', [enc.encumbranceId, JSON.stringify({ termsHash: null })]);
    expect(cleared.termsHash).to.equal(null);
  });

  it('update guards: other bank, no-op, unknown fields, released, wrong role', async () => {
    const enc = await h.addMortgage();
    await expectError(h.call(ID.nmb, 'UpdateEncumbrance', [enc.encumbranceId, JSON.stringify({ amount: 1 })]), 'FORBIDDEN', 'belongs to CRDB Bank');
    await expectError(h.call(ID.crdb, 'UpdateEncumbrance', [enc.encumbranceId, JSON.stringify({ amount: 90_000_000 })]), 'INVALID_ARGUMENT', 'Nothing changed');
    await expectError(h.call(ID.crdb, 'UpdateEncumbrance', [enc.encumbranceId, JSON.stringify({ parcelId: 'X' })]), 'INVALID_ARGUMENT', 'parcelId');
    await expectError(h.call(ID.registrar, 'UpdateEncumbrance', [enc.encumbranceId, JSON.stringify({ amount: 1 })]), 'FORBIDDEN');
    await h.call(ID.crdb, 'ReleaseEncumbrance', [enc.encumbranceId, 'Loan repaid']);
    await expectError(h.call(ID.crdb, 'UpdateEncumbrance', [enc.encumbranceId, JSON.stringify({ amount: 1 })]), 'INVALID_STATE', 'released');
    await expectError(h.call(ID.crdb, 'UpdateEncumbrance', ['ENC-0000000000000000', '{}']), 'NOT_FOUND');
  });

  it('release marks RELEASED (never deletes) and frees the parcel', async () => {
    const enc = await h.addMortgage();
    const rel = await h.call<Encumbrance>(ID.crdb, 'ReleaseEncumbrance', [enc.encumbranceId, 'Loan fully repaid']);
    expect(rel).to.include({ status: 'RELEASED', releaseReason: 'Loan fully repaid' });
    expect(rel.releasedBy?.id).to.equal(ID.crdb.id);
    expect(h.parcel()).to.deep.include({ status: 'ACTIVE', activeEncumbranceIds: [], encumbranceIds: [enc.encumbranceId] });
    expect(h.ledger.lastEvent()?.name).to.equal('milki.Encumbrance.Released');
    await expectError(h.call(ID.crdb, 'ReleaseEncumbrance', [enc.encumbranceId, 'Again']), 'INVALID_STATE', 'already been released');
  });

  it('release guards: other bank, reason, role', async () => {
    const enc = await h.addMortgage();
    await expectError(h.call(ID.nmb, 'ReleaseEncumbrance', [enc.encumbranceId, 'Repaid']), 'FORBIDDEN', 'Only that bank');
    await expectError(h.call(ID.crdb, 'ReleaseEncumbrance', [enc.encumbranceId, '']), 'INVALID_ARGUMENT');
    await expectError(h.call(ID.registrar, 'ReleaseEncumbrance', [enc.encumbranceId, 'Repaid']), 'FORBIDDEN');
  });

  it('a parcel with two charges stays ENCUMBERED until both are released', async () => {
    const a = await h.addMortgage(ID.crdb);
    const b = await h.addMortgage(ID.nmb);
    await h.call(ID.crdb, 'ReleaseEncumbrance', [a.encumbranceId, 'Repaid']);
    expect(h.parcel().status).to.equal('ENCUMBERED');
    await expectError(h.initiate(), 'PARCEL_ENCUMBERED', 'NMB Bank');
    await h.call(ID.nmb, 'ReleaseEncumbrance', [b.encumbranceId, 'Repaid']);
    expect(h.parcel().status).to.equal('ACTIVE');

    const list = await h.call<Encumbrance[]>(ID.support, 'GetEncumbrances', [PARCEL_ID]);
    expect(list.map((e) => e.status)).to.deep.equal(['RELEASED', 'RELEASED']);
    const one = await h.call<Encumbrance>(ID.support, 'GetEncumbrance', [b.encumbranceId]);
    expect(one.lenderCode).to.equal('NMB');
  });
});

describe('Dispute', () => {
  let h: Harness;
  beforeEach(async () => {
    h = new Harness();
    await h.register();
  });

  it('a land officer flags a dispute; the parcel becomes DISPUTED', async () => {
    const d = await h.flagDispute();
    expect(d).to.include({ status: 'OPEN', category: 'BOUNDARY', parcelId: PARCEL_ID });
    expect(d.disputeId).to.match(/^DSP-/);
    expect(h.parcel()).to.deep.include({ status: 'DISPUTED', openDisputeIds: [d.disputeId] });
    expect(h.ledger.lastEvent()?.name).to.equal('milki.Dispute.Flagged');
  });

  it('flag guards: role, category, summary length, retired parcel', async () => {
    const body = JSON.stringify({ category: 'FRAUD', summary: 'Two sale agreements for the same plot.' });
    await expectError(h.call(ID.registrar, 'FlagDispute', [PARCEL_ID, body]), 'FORBIDDEN', 'land officer');
    await expectError(h.call(ID.seller, 'FlagDispute', [PARCEL_ID, body]), 'FORBIDDEN');
    await expectError(h.call(ID.officer, 'FlagDispute', [PARCEL_ID, JSON.stringify({ category: 'NOISE', summary: 'Too loud neighbours here.' })]), 'INVALID_ARGUMENT', 'category');
    await expectError(h.call(ID.officer, 'FlagDispute', [PARCEL_ID, JSON.stringify({ category: 'FRAUD', summary: 'short' })]), 'INVALID_ARGUMENT', 'summary');
    await h.call(ID.registrar, 'RetireParcel', [PARCEL_ID, 'Merged']);
    await expectError(h.call(ID.officer, 'FlagDispute', [PARCEL_ID, body]), 'PARCEL_RETIRED');
  });

  it('officers and registrars add notes to open disputes only', async () => {
    const d = await h.flagDispute();
    await h.call(ID.officer, 'AddDisputeNote', [d.disputeId, 'Site visit booked for Monday.']);
    const withNotes = await h.call<Dispute>(ID.registrar, 'AddDisputeNote', [d.disputeId, 'Surveyor assigned.']);
    expect(withNotes.notes.map((n) => n.by.role)).to.deep.equal(['LAND_OFFICER', 'REGISTRAR']);
    expect(h.ledger.lastEvent()?.name).to.equal('milki.Dispute.NoteAdded');
    await expectError(h.call(ID.seller, 'AddDisputeNote', [d.disputeId, 'I disagree!']), 'FORBIDDEN');
    await expectError(h.call(ID.officer, 'AddDisputeNote', [d.disputeId, 'x']), 'INVALID_ARGUMENT', 'note');
    await h.call(ID.officer, 'ResolveDispute', [d.disputeId, 'Boundary confirmed by resurvey.']);
    await expectError(h.call(ID.officer, 'AddDisputeNote', [d.disputeId, 'Late note']), 'INVALID_STATE', 'resolved');
  });

  it('resolving restores the underlying status (ENCUMBERED stays visible)', async () => {
    await h.addMortgage();
    const d = await h.flagDispute();
    expect(h.parcel().status).to.equal('DISPUTED');
    const r = await h.call<Dispute>(ID.registrar, 'ResolveDispute', [d.disputeId, 'Claim withdrawn.']);
    expect(r).to.include({ status: 'RESOLVED', resolution: 'Claim withdrawn.' });
    expect(h.parcel()).to.deep.include({ status: 'ENCUMBERED', openDisputeIds: [], disputeIds: [d.disputeId] });
    expect(h.ledger.lastEvent()?.name).to.equal('milki.Dispute.Resolved');
    await expectError(h.call(ID.officer, 'ResolveDispute', [d.disputeId, 'Again']), 'INVALID_STATE', 'already been resolved');
    await expectError(h.call(ID.crdb, 'ResolveDispute', [d.disputeId, 'Again']), 'FORBIDDEN');
    await expectError(h.call(ID.officer, 'ResolveDispute', ['DSP-0000000000000000', 'x reason']), 'NOT_FOUND');
  });

  it('GetDisputes lists every dispute ever flagged on the parcel', async () => {
    const d1 = await h.flagDispute();
    await h.call(ID.officer, 'ResolveDispute', [d1.disputeId, 'Settled']);
    const d2 = await h.flagDispute();
    const list = await h.call<Dispute[]>(ID.peerAdmin, 'GetDisputes', [PARCEL_ID]);
    expect(list.map((d) => [d.disputeId, d.status])).to.deep.equal([
      [d1.disputeId, 'RESOLVED'],
      [d2.disputeId, 'OPEN'],
    ]);
  });
});
