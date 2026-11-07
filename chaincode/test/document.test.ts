import { expect } from 'chai';
import type { DocumentRef } from '../src/models';
import type { DocumentVerification } from '../src/services/document.service';
import { Harness, ID, PARCEL_ID, expectError, hash } from './support/harness';

describe('Document references', () => {
  let h: Harness;
  beforeEach(async () => {
    h = new Harness();
    await h.register();
  });

  it('the owner attaches a title deed hash to the parcel (file stays off-chain)', async () => {
    const d = await h.attach(ID.seller, 'PARCEL', PARCEL_ID, 'TITLE_DEED', 'deed-v1.pdf');
    expect(d).to.include({ targetType: 'PARCEL', targetId: PARCEL_ID, parcelId: PARCEL_ID, sha256: hash('deed-v1.pdf'), version: 1, status: 'ACTIVE' });
    expect(d.rootDocumentId).to.equal(d.documentId);
    expect(h.parcel().documentIds).to.deep.equal([d.documentId]);
    expect(h.ledger.lastEvent()?.payload).to.deep.include({ entity: 'Document', action: 'Attached' });
  });

  it('registrars and land officers can attach to any parcel; strangers and support cannot', async () => {
    await h.attach(ID.registrar, 'PARCEL', PARCEL_ID, 'SURVEY_PLAN', 'survey.pdf');
    await h.attach(ID.officer, 'PARCEL', PARCEL_ID, 'VALUATION_REPORT', 'valuation.pdf');
    await expectError(h.attach(ID.stranger, 'PARCEL', PARCEL_ID, 'OTHER', 'x.pdf'), 'FORBIDDEN', 'not allowed');
    await expectError(h.attach(ID.support, 'PARCEL', PARCEL_ID, 'OTHER', 'x.pdf'), 'FORBIDDEN');
  });

  it('a bank may attach a MORTGAGE_DEED only where it holds an active encumbrance', async () => {
    await expectError(h.attach(ID.crdb, 'PARCEL', PARCEL_ID, 'MORTGAGE_DEED', 'deed.pdf'), 'FORBIDDEN');
    await h.addMortgage(ID.crdb);
    await expectError(h.attach(ID.nmb, 'PARCEL', PARCEL_ID, 'MORTGAGE_DEED', 'deed.pdf'), 'FORBIDDEN');
    await expectError(h.attach(ID.crdb, 'PARCEL', PARCEL_ID, 'TITLE_DEED', 'deed.pdf'), 'FORBIDDEN');
    const d = await h.attach(ID.crdb, 'PARCEL', PARCEL_ID, 'MORTGAGE_DEED', 'deed.pdf');
    expect(d.createdBy.role).to.equal('BANK_OFFICER');
  });

  it('rejects the same file twice on one target', async () => {
    const d = await h.attach(ID.seller, 'PARCEL', PARCEL_ID, 'TITLE_DEED', 'deed.pdf');
    const err = await expectError(h.attach(ID.registrar, 'PARCEL', PARCEL_ID, 'OTHER', 'deed.pdf'), 'CONFLICT', 'already attached');
    expect(err.details).to.include({ documentId: d.documentId });
  });

  it('validates input', async () => {
    const send = (body: Record<string, unknown>) => h.call(ID.registrar, 'AttachDocument', [JSON.stringify(body)]);
    await expectError(send({ targetType: 'USER', targetId: PARCEL_ID, documentType: 'OTHER', sha256: hash('a') }), 'INVALID_ARGUMENT', 'targetType');
    await expectError(send({ targetType: 'PARCEL', targetId: PARCEL_ID, documentType: 'SELFIE', sha256: hash('a') }), 'INVALID_ARGUMENT', 'documentType');
    await expectError(send({ targetType: 'PARCEL', targetId: PARCEL_ID, documentType: 'OTHER', sha256: 'ABC' }), 'INVALID_ARGUMENT', 'sha256');
    await expectError(send({ targetType: 'PARCEL', targetId: PARCEL_ID, documentType: 'OTHER', sha256: hash('a'), url: 'http://x' }), 'INVALID_ARGUMENT', 'url');
    await expectError(send({ targetType: 'PARCEL', targetId: 'DSM-KIN-99-99', documentType: 'OTHER', sha256: hash('a') }), 'NOT_FOUND');
  });

  it('retired parcels take no new documents', async () => {
    await h.call(ID.registrar, 'RetireParcel', [PARCEL_ID, 'Merged']);
    await expectError(h.attach(ID.registrar, 'PARCEL', PARCEL_ID, 'OTHER', 'x.pdf'), 'PARCEL_RETIRED');
  });

  describe('on transfers', () => {
    it('seller, buyer and officials attach while the transfer is open', async () => {
      const t = await h.initiate();
      await h.attach(ID.seller, 'TRANSFER', t.transferId, 'SALE_AGREEMENT', 'agreement.pdf');
      await h.attach(ID.buyer, 'TRANSFER', t.transferId, 'PAYMENT_PROOF', 'bank-slip.pdf');
      await h.attach(ID.officer, 'TRANSFER', t.transferId, 'TAX_RECEIPT', 'tra.pdf');
      expect(h.transfer(t.transferId).documentIds).to.have.length(3);
      await expectError(h.attach(ID.stranger, 'TRANSFER', t.transferId, 'OTHER', 'x.pdf'), 'FORBIDDEN', 'parties to this transfer');
      await expectError(h.attach(ID.crdb, 'TRANSFER', t.transferId, 'OTHER', 'x.pdf'), 'FORBIDDEN');

      const docs = await h.call<DocumentRef[]>(ID.support, 'GetDocuments', ['TRANSFER', t.transferId]);
      expect(docs.map((d) => d.documentType)).to.deep.equal(['SALE_AGREEMENT', 'PAYMENT_PROOF', 'TAX_RECEIPT']);
    });

    it('closed transfers take no new documents', async () => {
      const t = await h.initiate();
      await h.call(ID.seller, 'CancelTransfer', [t.transferId, 'Withdrawn']);
      await expectError(h.attach(ID.seller, 'TRANSFER', t.transferId, 'OTHER', 'x.pdf'), 'INVALID_STATE', 'already closed');
    });
  });

  describe('SupersedeDocument and VerifyDocument', () => {
    it('creates version 2 and keeps the old hash on the ledger as SUPERSEDED', async () => {
      const v1 = await h.attach(ID.seller, 'PARCEL', PARCEL_ID, 'TITLE_DEED', 'deed-v1.pdf');
      const v2 = await h.call<DocumentRef>(ID.registrar, 'SupersedeDocument', [v1.documentId, hash('deed-v2.pdf')]);
      expect(v2).to.include({ version: 2, supersedes: v1.documentId, rootDocumentId: v1.documentId, status: 'ACTIVE', sha256: hash('deed-v2.pdf') });
      const old = h.ledger.json<DocumentRef>(`DOCUMENT_${v1.documentId}`);
      expect(old).to.include({ status: 'SUPERSEDED', supersededBy: v2.documentId, sha256: hash('deed-v1.pdf') });
      expect(h.parcel().documentIds).to.deep.equal([v1.documentId, v2.documentId]);
      expect(h.ledger.lastEvent()?.name).to.equal('milki.Document.Superseded');

      const ok = await h.call<DocumentVerification>(ID.peerAdmin, 'VerifyDocument', [v2.documentId, hash('deed-v2.pdf')]);
      expect(ok).to.include({ match: true, status: 'ACTIVE', version: 2, latestDocumentId: null });
      const tampered = await h.call<DocumentVerification>(ID.peerAdmin, 'VerifyDocument', [v2.documentId, hash('forged.pdf')]);
      expect(tampered.match).to.equal(false);
      const stale = await h.call<DocumentVerification>(ID.peerAdmin, 'VerifyDocument', [v1.documentId, hash('deed-v1.pdf')]);
      expect(stale).to.include({ match: true, status: 'SUPERSEDED', latestDocumentId: v2.documentId });
    });

    it('guards: already superseded, identical file, permission, unknown ID', async () => {
      const v1 = await h.attach(ID.seller, 'PARCEL', PARCEL_ID, 'TITLE_DEED', 'deed-v1.pdf');
      await expectError(h.call(ID.seller, 'SupersedeDocument', [v1.documentId, hash('deed-v1.pdf')]), 'INVALID_ARGUMENT', 'identical');
      await expectError(h.call(ID.stranger, 'SupersedeDocument', [v1.documentId, hash('deed-v2.pdf')]), 'FORBIDDEN');
      await expectError(h.call(ID.support, 'SupersedeDocument', [v1.documentId, hash('deed-v2.pdf')]), 'FORBIDDEN');
      const v2 = await h.call<DocumentRef>(ID.seller, 'SupersedeDocument', [v1.documentId, hash('deed-v2.pdf')]);
      await expectError(h.call(ID.seller, 'SupersedeDocument', [v1.documentId, hash('deed-v3.pdf')]), 'INVALID_STATE', v2.documentId);
      await expectError(h.call(ID.seller, 'SupersedeDocument', ['DOC-0000000000000000', hash('x')]), 'NOT_FOUND');
    });

    it('works for transfer documents too', async () => {
      const t = await h.initiate();
      const v1 = await h.attach(ID.seller, 'TRANSFER', t.transferId, 'SALE_AGREEMENT', 'agreement.pdf');
      const v2 = await h.call<DocumentRef>(ID.buyer, 'SupersedeDocument', [v1.documentId, hash('agreement-signed.pdf')]);
      expect(v2.targetId).to.equal(t.transferId);
      expect(h.transfer(t.transferId).documentIds).to.deep.equal([v1.documentId, v2.documentId]);
    });

    it('GetDocuments validates the target', async () => {
      await expectError(h.call(ID.support, 'GetDocuments', ['USER', 'x']), 'INVALID_ARGUMENT', 'targetType');
      await expectError(h.call(ID.support, 'GetDocuments', ['TRANSFER', 'TRF-0000000000000000']), 'NOT_FOUND');
      const docs = await h.call<DocumentRef[]>(ID.support, 'GetDocuments', ['PARCEL', PARCEL_ID]);
      expect(docs).to.deep.equal([]);
    });
  });
});
