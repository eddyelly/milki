import { expect } from 'chai';
import type { Page } from '../src/ledger';
import type { Parcel, Transfer, TransferPrivateDetails } from '../src/models';
import { BUYER_NIDA, Harness, ID, PARCEL_ID, SELLER_NIDA, expectError, hash, privateSale } from './support/harness';

describe('Transfer', () => {
  let h: Harness;
  beforeEach(async () => {
    h = new Harness();
    await h.register();
  });

  describe('happy path', () => {
    it('INITIATED → BUYER_ACCEPTED → PAYMENTS_CONFIRMED → OFFICER_VERIFIED → APPROVED → COMPLETED moves ownership', async () => {
      const t0 = await h.initiate();
      expect(t0.transferId).to.match(/^TRF-[A-F0-9]{16}$/);
      expect(t0).to.include({ status: 'INITIATED', sellerId: ID.seller.id, buyerId: ID.buyer.id, ownershipVersion: 1 });
      expect(h.parcel()).to.include({ status: 'PENDING_TRANSFER', activeTransferId: t0.transferId });

      const id = t0.transferId;
      await h.accept(id);
      const t2 = await h.confirm(id);
      expect(t2).to.include({ status: 'PAYMENTS_CONFIRMED', paymentReference: 'TRA-2026-000981', paymentEvidenceHash: hash('receipt.pdf') });
      const t3 = await h.verify(id);
      expect(t3.verifiedBy).to.deep.equal({ id: 'officer1', mspId: 'Org2MSP', role: 'LAND_OFFICER' });
      const done = await h.approve(id);

      expect(done.status).to.equal('COMPLETED');
      expect(done.approvedBy?.role).to.equal('REGISTRAR');
      expect(done.history.map((s) => s.status)).to.deep.equal([
        'INITIATED',
        'BUYER_ACCEPTED',
        'PAYMENTS_CONFIRMED',
        'OFFICER_VERIFIED',
        'APPROVED',
        'COMPLETED',
      ]);

      const p = h.parcel();
      expect(p).to.include({ ownerId: ID.buyer.id, ownerNidaHash: BUYER_NIDA, ownershipVersion: 2, activeTransferId: null, status: 'ACTIVE' });
      expect(p.transferIds).to.deep.equal([id]);

      expect(h.ledger.events.slice(1).map((e) => e.name)).to.deep.equal([
        'milki.Transfer.Initiated',
        'milki.Transfer.Accepted',
        'milki.Transfer.PaymentsConfirmed',
        'milki.Transfer.Verified',
        'milki.Transfer.Approved',
      ]);
      expect(h.ledger.lastEvent()?.payload).to.deep.include({
        status: 'COMPLETED',
        data: { sellerId: ID.seller.id, buyerId: ID.buyer.id, previousOwnerId: ID.seller.id, newOwnerId: ID.buyer.id, ownershipVersion: 2 },
      });
    });

    it('keeps the sale price off the shared ledger (rule 4)', async () => {
      const t = await h.initiate();
      const priv = h.ledger.privateJson<TransferPrivateDetails>('transferPrivate', `TRANSFER_${t.transferId}`);
      expect(priv).to.include({ transferId: t.transferId, salePrice: 185_000_000, currency: 'TZS' });
      const publicBytes = [...h.ledger.state.values()].map((b) => new TextDecoder().decode(b)).join('');
      const eventsJson = JSON.stringify(h.ledger.events);
      for (const secret of ['185000000', 'NIDA-REF-SELLER-0001', privateSale().buyerContactHash as string]) {
        expect(publicBytes).not.to.include(secret);
        expect(eventsJson).not.to.include(secret);
      }
    });

    it('lets the new owner sell on, and stops the previous owner', async () => {
      await h.transferAt('COMPLETED');
      await expectError(h.initiate(PARCEL_ID, ID.stranger.id, hash('stranger')), 'FORBIDDEN', 'registered owner');
      const t = await h.call<Transfer>(ID.buyer, 'InitiateTransfer', [PARCEL_ID, ID.stranger.id, hash('stranger')], { transfer: privateSale() });
      expect(t).to.include({ sellerId: ID.buyer.id, ownershipVersion: 2 });
    });
  });

  describe('InitiateTransfer guards', () => {
    it('only the registered owner, as a citizen, can initiate', async () => {
      await expectError(
        h.call(ID.stranger, 'InitiateTransfer', [PARCEL_ID, ID.buyer.id, BUYER_NIDA], { transfer: privateSale() }),
        'FORBIDDEN',
        'registered owner',
      );
      await expectError(
        h.call(ID.registrar, 'InitiateTransfer', [PARCEL_ID, ID.buyer.id, BUYER_NIDA], { transfer: privateSale() }),
        'FORBIDDEN',
        'Only a landowner',
      );
    });

    it('rejects a transfer to yourself (by ID or by NIDA hash)', async () => {
      await expectError(h.initiate(PARCEL_ID, ID.seller.id, BUYER_NIDA), 'INVALID_ARGUMENT', 'yourself');
      await expectError(h.initiate(PARCEL_ID, ID.buyer.id, SELLER_NIDA), 'INVALID_ARGUMENT', 'yourself');
    });

    it('requires private sale details in the transient map, validated', async () => {
      await expectError(h.call(ID.seller, 'InitiateTransfer', [PARCEL_ID, ID.buyer.id, BUYER_NIDA]), 'INVALID_ARGUMENT', 'sent privately');
      await expectError(h.initiate(PARCEL_ID, ID.buyer.id, BUYER_NIDA, privateSale({ salePrice: -1 })), 'INVALID_ARGUMENT', 'salePrice');
      await expectError(h.initiate(PARCEL_ID, ID.buyer.id, BUYER_NIDA, privateSale({ currency: 'shillings' })), 'INVALID_ARGUMENT', 'currency');
      await expectError(h.initiate(PARCEL_ID, ID.buyer.id, BUYER_NIDA, privateSale({ phone: '+255' })), 'INVALID_ARGUMENT', 'phone');
      await expectError(h.initiate(PARCEL_ID, ID.buyer.id, 'not-a-hash'), 'INVALID_ARGUMENT', 'buyerNidaHash');
      await expectError(h.initiate(PARCEL_ID, 'x', BUYER_NIDA), 'INVALID_ARGUMENT', 'buyerId');
      expect(h.parcel().activeTransferId).to.equal(null); // atomic
    });

    it('allows only one active transfer per parcel', async () => {
      const t = await h.initiate();
      const err = await expectError(h.initiate(PARCEL_ID, ID.stranger.id, hash('s')), 'TRANSFER_IN_PROGRESS');
      expect(err.details).to.include({ transferId: t.transferId });
    });

    it('is blocked while ENCUMBERED, with a human-readable lender message', async () => {
      await h.addMortgage();
      await expectError(h.initiate(), 'PARCEL_ENCUMBERED', 'This parcel has an active mortgage with CRDB Bank');
    });

    it('is blocked while DISPUTED, FROZEN or RETIRED, and for unknown parcels', async () => {
      const d = await h.flagDispute();
      await expectError(h.initiate(), 'PARCEL_DISPUTED', 'open dispute');
      await h.call(ID.officer, 'ResolveDispute', [d.disputeId, 'Beacon re-surveyed']);

      await h.call(ID.registrar, 'FreezeParcel', [PARCEL_ID, 'Court order 44/2026']);
      await expectError(h.initiate(), 'PARCEL_FROZEN', 'Court order 44/2026');
      await h.call(ID.registrar, 'UnfreezeParcel', [PARCEL_ID, 'Lifted']);

      await h.call(ID.registrar, 'RetireParcel', [PARCEL_ID, 'Merged']);
      await expectError(h.initiate(), 'PARCEL_RETIRED');
      await expectError(h.initiate('DSM-KIN-99-99'), 'NOT_FOUND');
    });

    it('the encumbrance message falls back gracefully if the record is missing', async () => {
      const p = h.parcel();
      p.activeEncumbranceIds = ['ENC-0000000000000000'];
      h.ledger.state.set(`PARCEL_${PARCEL_ID}`, new TextEncoder().encode(JSON.stringify(p)));
      await expectError(h.initiate(), 'PARCEL_ENCUMBERED', 'an active encumbrance');
    });
  });

  describe('illegal transitions', () => {
    it('AcceptTransfer: only the named buyer, only from INITIATED', async () => {
      const t = await h.initiate();
      await expectError(h.call(ID.stranger, 'AcceptTransfer', [t.transferId]), 'FORBIDDEN', 'buyer named');
      await expectError(h.call(ID.officer, 'AcceptTransfer', [t.transferId]), 'FORBIDDEN');
      await h.accept(t.transferId);
      await expectError(h.accept(t.transferId), 'INVALID_STATE', 'waiting for payment confirmation');
    });

    it('AcceptTransfer is blocked once a dispute is flagged mid-transfer', async () => {
      const t = await h.initiate();
      await h.flagDispute();
      await expectError(h.accept(t.transferId), 'PARCEL_DISPUTED');
    });

    it('ConfirmPayments: land officer only, only after acceptance, valid evidence', async () => {
      const t = await h.initiate();
      await expectError(h.confirm(t.transferId), 'INVALID_STATE', 'waiting for the buyer to accept');
      await h.accept(t.transferId);
      await expectError(h.call(ID.registrar, 'ConfirmPayments', [t.transferId, 'TRA-1', hash('r')]), 'FORBIDDEN', 'land officer');
      await expectError(h.call(ID.officer, 'ConfirmPayments', [t.transferId, 'TRA-1', 'nope']), 'INVALID_ARGUMENT', 'paymentEvidenceHash');
      await expectError(h.call(ID.officer, 'ConfirmPayments', [t.transferId, '', hash('r')]), 'INVALID_ARGUMENT', 'paymentReference');
    });

    it('VerifyTransfer: land officer only, only after payments, blocked by a freeze', async () => {
      const t = await h.transferAt('BUYER_ACCEPTED');
      await expectError(h.verify(t.transferId), 'INVALID_STATE', 'waiting for payment confirmation');
      await h.confirm(t.transferId);
      await expectError(h.call(ID.registrar, 'VerifyTransfer', [t.transferId, '']), 'FORBIDDEN');
      await h.call(ID.registrar, 'FreezeParcel', [PARCEL_ID, 'Fraud investigation']);
      await expectError(h.verify(t.transferId), 'PARCEL_FROZEN');
    });

    it('ApproveTransfer: registrar only, only after verification', async () => {
      const t = await h.transferAt('PAYMENTS_CONFIRMED');
      await expectError(h.approve(t.transferId), 'INVALID_STATE', 'waiting for a land officer');
      await h.verify(t.transferId);
      await expectError(h.call(ID.officer2, 'ApproveTransfer', [t.transferId, '']), 'FORBIDDEN', 'registrar');
      await expectError(h.call(ID.seller, 'ApproveTransfer', [t.transferId, '']), 'FORBIDDEN');
    });

    it('ApproveTransfer: the approver must have a different role (and identity) from the verifier', async () => {
      const t = await h.transferAt('OFFICER_VERIFIED');
      const stored = h.transfer(t.transferId);
      stored.verifiedBy = { id: 'registrar2', mspId: 'Org1MSP', role: 'REGISTRAR' };
      h.ledger.state.set(`TRANSFER_${t.transferId}`, new TextEncoder().encode(JSON.stringify(stored)));
      await expectError(h.approve(t.transferId), 'FORBIDDEN', 'different role');

      stored.verifiedBy = null;
      h.ledger.state.set(`TRANSFER_${t.transferId}`, new TextEncoder().encode(JSON.stringify(stored)));
      await expectError(h.approve(t.transferId), 'FORBIDDEN', 'different role');
    });

    it('ApproveTransfer: blocked by a dispute flagged after verification', async () => {
      const t = await h.transferAt('OFFICER_VERIFIED');
      await h.flagDispute();
      await expectError(h.approve(t.transferId), 'PARCEL_DISPUTED');
      expect(h.parcel().ownerId).to.equal(ID.seller.id);
    });

    it('Verify/Approve: refuse if ownership changed since initiation', async () => {
      const t = await h.transferAt('OFFICER_VERIFIED');
      const p = h.parcel();
      p.ownershipVersion = 7;
      h.ledger.state.set(`PARCEL_${PARCEL_ID}`, new TextEncoder().encode(JSON.stringify(p)));
      await expectError(h.approve(t.transferId), 'INVALID_STATE', 'Ownership of this parcel has changed');
    });

    it('nothing moves a COMPLETED, CANCELLED or REJECTED transfer', async () => {
      const done = await h.transferAt('COMPLETED');
      await expectError(h.approve(done.transferId), 'INVALID_STATE', 'already completed');
      await expectError(h.accept(done.transferId), 'INVALID_STATE');
      await expectError(h.call(ID.seller, 'CancelTransfer', [done.transferId, 'Too late']), 'INVALID_STATE', 'already completed');
      await expectError(h.call(ID.registrar, 'RejectTransfer', [done.transferId, 'Too late']), 'INVALID_STATE', 'already completed');
    });
  });

  describe('CancelTransfer', () => {
    for (const status of ['INITIATED', 'BUYER_ACCEPTED', 'PAYMENTS_CONFIRMED'] as const) {
      it(`the seller can cancel from ${status}, freeing the parcel`, async () => {
        const t = await h.transferAt(status);
        const c = await h.call<Transfer>(ID.seller, 'CancelTransfer', [t.transferId, 'Buyer withdrew']);
        expect(c).to.include({ status: 'CANCELLED', closedReason: 'Buyer withdrew' });
        expect(h.parcel()).to.include({ status: 'ACTIVE', activeTransferId: null });
        expect(h.ledger.lastEvent()?.name).to.equal('milki.Transfer.Cancelled');
        await expectError(h.accept(t.transferId), 'INVALID_STATE', 'cancelled');
        await h.initiate(); // parcel is free again
      });
    }

    it('cannot cancel after officer verification', async () => {
      const t = await h.transferAt('OFFICER_VERIFIED');
      await expectError(h.call(ID.seller, 'CancelTransfer', [t.transferId, 'Changed mind']), 'INVALID_STATE', 'already been verified');
    });

    it('only the seller, with a reason', async () => {
      const t = await h.initiate();
      await expectError(h.call(ID.buyer, 'CancelTransfer', [t.transferId, 'Nope']), 'FORBIDDEN', 'Only the seller');
      await expectError(h.call(ID.officer, 'CancelTransfer', [t.transferId, 'Nope']), 'FORBIDDEN');
      await expectError(h.call(ID.seller, 'CancelTransfer', [t.transferId, '']), 'INVALID_ARGUMENT', 'reason');
    });

    it('still works while the parcel is frozen', async () => {
      const t = await h.initiate();
      await h.call(ID.registrar, 'FreezeParcel', [PARCEL_ID, 'Investigation']);
      await h.call(ID.seller, 'CancelTransfer', [t.transferId, 'Abandoning sale']);
      expect(h.parcel()).to.include({ status: 'FROZEN', activeTransferId: null });
    });

    it('does not clobber a parcel that already points elsewhere', async () => {
      const t = await h.initiate();
      const p = h.parcel();
      p.activeTransferId = 'TRF-FFFFFFFFFFFFFFFF';
      h.ledger.state.set(`PARCEL_${PARCEL_ID}`, new TextEncoder().encode(JSON.stringify(p)));
      await h.call(ID.seller, 'CancelTransfer', [t.transferId, 'Withdrawn']);
      expect(h.parcel().activeTransferId).to.equal('TRF-FFFFFFFFFFFFFFFF');
    });
  });

  describe('RejectTransfer', () => {
    it('a land officer can reject before verification', async () => {
      const t = await h.transferAt('PAYMENTS_CONFIRMED');
      const r = await h.call<Transfer>(ID.officer, 'RejectTransfer', [t.transferId, 'Forged sale agreement']);
      expect(r).to.include({ status: 'REJECTED', closedReason: 'Forged sale agreement' });
      expect(h.parcel()).to.include({ status: 'ACTIVE', activeTransferId: null });
      expect(h.ledger.lastEvent()?.name).to.equal('milki.Transfer.Rejected');
    });

    it('after verification only a registrar can reject', async () => {
      const t = await h.transferAt('OFFICER_VERIFIED');
      await expectError(h.call(ID.officer, 'RejectTransfer', [t.transferId, 'Doubts']), 'FORBIDDEN', 'only a registrar');
      const r = await h.call<Transfer>(ID.registrar, 'RejectTransfer', [t.transferId, 'Valuation mismatch']);
      expect(r.status).to.equal('REJECTED');
    });

    it('citizens and banks cannot reject; a reason is required', async () => {
      const t = await h.initiate();
      await expectError(h.call(ID.seller, 'RejectTransfer', [t.transferId, 'x reason']), 'FORBIDDEN');
      await expectError(h.call(ID.crdb, 'RejectTransfer', [t.transferId, 'x reason']), 'FORBIDDEN');
      await expectError(h.call(ID.officer, 'RejectTransfer', [t.transferId, ' ']), 'INVALID_ARGUMENT');
    });

    it('cannot reject a transfer stuck in APPROVED', async () => {
      const t = await h.transferAt('OFFICER_VERIFIED');
      const stored = h.transfer(t.transferId);
      stored.status = 'APPROVED';
      h.ledger.state.set(`TRANSFER_${t.transferId}`, new TextEncoder().encode(JSON.stringify(stored)));
      await expectError(h.call(ID.registrar, 'RejectTransfer', [t.transferId, 'Late']), 'INVALID_STATE', 'already approved');
    });
  });

  describe('reads', () => {
    it('GetTransfer validates the ID and returns NOT_FOUND', async () => {
      await expectError(h.call(ID.support, 'GetTransfer', ['bad']), 'INVALID_ARGUMENT', 'transferId');
      await expectError(h.call(ID.support, 'GetTransfer', ['TRF-0000000000000000']), 'NOT_FOUND');
      const t = await h.initiate();
      expect((await h.call<Transfer>(ID.support, 'GetTransfer', [t.transferId])).transferId).to.equal(t.transferId);
    });

    it('QueryTransfers filters by party and status', async () => {
      const t = await h.initiate();
      const page = await h.call<Page<Transfer>>(ID.support, 'QueryTransfers', [JSON.stringify({ selector: { buyerId: ID.buyer.id, status: { $in: ['INITIATED'] } } }), '10', '']);
      expect(page.records.map((r) => r.transferId)).to.deep.equal([t.transferId]);
      const none = await h.call<Page<Transfer>>(ID.support, 'QueryTransfers', [JSON.stringify({ selector: { buyerId: ID.stranger.id } }), '10', '']);
      expect(none.records).to.have.length(0);
    });

    it('GetParcelTransfers lists a parcel’s transfers', async () => {
      const t = await h.initiate();
      const list = await h.call<Transfer[]>(ID.support, 'GetParcelTransfers', [PARCEL_ID]);
      expect(list.map((x) => x.transferId)).to.deep.equal([t.transferId]);
    });

    it('GetTransferPrivateDetails: parties and officials only', async () => {
      const t = await h.initiate();
      for (const who of [ID.seller, ID.buyer, ID.officer, ID.registrar]) {
        const d = await h.call<TransferPrivateDetails>(who, 'GetTransferPrivateDetails', [t.transferId]);
        expect(d.salePrice).to.equal(185_000_000);
      }
      for (const who of [ID.stranger, ID.crdb, ID.support, ID.peerAdmin]) {
        await expectError(h.call(who, 'GetTransferPrivateDetails', [t.transferId]), 'FORBIDDEN', 'sale details');
      }
      h.ledger.privateData.get('transferPrivate')?.clear();
      await expectError(h.call(ID.seller, 'GetTransferPrivateDetails', [t.transferId]), 'NOT_FOUND', 'not available on this peer');
    });
  });

  it('a parcel read after completion shows the buyer as owner', async () => {
    await h.transferAt('COMPLETED');
    const p = await h.call<Parcel>(ID.peerAdmin, 'GetParcel', [PARCEL_ID]);
    expect(p.ownerId).to.equal(ID.buyer.id);
  });
});
