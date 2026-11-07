import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../src/core/errors';
import { ledger } from '../src/core/fabric/ledger';
import { AuditLog } from '../src/modules/audit/audit.model';
import { DocumentFile } from '../src/modules/documents/document-file.model';
import { TransferCache } from '../src/modules/transfers/transfer-cache.model';
import type { LedgerTransfer } from '../src/modules/transfers/transfer.types';
import { api, idemKey, makeUser, reauth } from './helpers';

const evaluate = vi.mocked(ledger.evaluate);
const submit = vi.mocked(ledger.submit);
const TX = 'd'.repeat(64);
const TRF = 'TRF-0123456789ABCDEF';

const ledgerTransfer = (over: Partial<LedgerTransfer> = {}): LedgerTransfer => ({
  docType: 'transfer',
  transferId: TRF,
  parcelId: 'DSM-KIN-12-45',
  sellerId: 'usr_seller',
  buyerId: 'usr_buyer',
  buyerNidaHash: 'e'.repeat(64),
  ownershipVersion: 1,
  status: 'INITIATED',
  paymentReference: null,
  paymentEvidenceHash: null,
  verifiedBy: null,
  approvedBy: null,
  closedReason: null,
  documentIds: [],
  history: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  createdBy: { id: 'usr_seller', mspId: 'Org1MSP', role: 'CITIZEN' },
  updatedAt: '2026-01-01T00:00:00.000Z',
  updatedBy: { id: 'usr_seller', mspId: 'Org1MSP', role: 'CITIZEN' },
  lastTxId: TX,
  ...over,
});

async function t3(token: string, path: string, body: object) {
  return api().post(`/api/v1/transfers${path}`).set('Authorization', `Bearer ${token}`).set('Idempotency-Key', idemKey()).set('X-Reauth-Token', await reauth(token)).send(body);
}

describe('POST /transfers (initiate)', () => {
  it('resolves the buyer and sends price, NIDA refs and contact hashes ONLY in the transient map', async () => {
    const seller = await makeUser('CITIZEN');
    const buyer = await makeUser('CITIZEN');
    submit.mockResolvedValueOnce({ txId: TX, result: ledgerTransfer() });

    const res = await t3(seller.token, '', { parcelId: 'dsm-kin-12-45', buyer: { phone: `0${buyer.user.phone.slice(4)}` }, salePrice: 185_000_000 });
    expect(res.status).toBe(202);
    expect(res.body.data).toEqual({ txId: TX, transferId: TRF, parcelId: 'DSM-KIN-12-45', status: 'SUBMITTED' });

    const [, fn, args, opts] = submit.mock.calls[0]!;
    expect(fn).toBe('InitiateTransfer');
    expect(args).toEqual(['DSM-KIN-12-45', buyer.user.userId, buyer.user.nidaHash]);
    const priv = (opts?.transient as { transfer: Record<string, unknown> }).transfer;
    expect(priv).toMatchObject({ salePrice: 185_000_000, currency: 'TZS', sellerNidaRef: `NIDA••••${seller.nida.slice(-4)}` });
    expect(priv.sellerContactHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(args)).not.toContain('185000000');
    expect(JSON.stringify(priv)).not.toContain(buyer.nida);

    const audit = await AuditLog.findOne({ action: 'transfer.initiate' }).lean();
    expect(audit).toMatchObject({ entityId: TRF, txId: TX });
    expect(JSON.stringify(audit)).not.toContain('185000000'); // the price stays out of the audit log
  });

  it('refuses self-transfers, unknown or unverified buyers, and non-citizens', async () => {
    const seller = await makeUser('CITIZEN');
    const pending = await makeUser('CITIZEN', { status: 'PENDING_VERIFICATION' });
    expect((await t3(seller.token, '', { parcelId: 'DSM-KIN-12-45', buyer: { userId: seller.user.userId }, salePrice: 1 })).body.error.code).toBe('SELF_TRANSFER');
    expect((await t3(seller.token, '', { parcelId: 'DSM-KIN-12-45', buyer: { nida: '19990101123450009999' }, salePrice: 1 })).body.error.code).toBe('USER_NOT_FOUND');
    expect((await t3(seller.token, '', { parcelId: 'DSM-KIN-12-45', buyer: { userId: pending.user.userId }, salePrice: 1 })).body.error.code).toBe('USER_NOT_ACTIVE');
    expect((await t3(seller.token, '', { parcelId: 'DSM-KIN-12-45', buyer: { userId: pending.user.userId }, salePrice: -1 })).status).toBe(400);
    const officer = await makeUser('LAND_OFFICER');
    expect((await t3(officer.token, '', { parcelId: 'DSM-KIN-12-45', buyer: { userId: seller.user.userId }, salePrice: 1 })).status).toBe(403);
    expect(submit).not.toHaveBeenCalled();
  });

  it('surfaces the chaincode guard message (e.g. mortgage) to the seller', async () => {
    const seller = await makeUser('CITIZEN');
    const buyer = await makeUser('CITIZEN');
    submit.mockRejectedValueOnce(new AppError(409, 'PARCEL_ENCUMBERED', 'This parcel has an active mortgage with CRDB Bank. It must be released before the parcel can be transferred.'));
    const res = await t3(seller.token, '', { parcelId: 'DSM-KIN-12-45', buyer: { userId: buyer.user.userId }, salePrice: 1 });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toContain('active mortgage with CRDB Bank');
  });
});

describe('state-machine actions', () => {
  it('each action goes to the right chaincode function, for the right role only', async () => {
    const buyer = await makeUser('CITIZEN');
    const officer = await makeUser('LAND_OFFICER');
    const registrar = await makeUser('REGISTRAR');
    submit.mockResolvedValue({ txId: TX, result: ledgerTransfer() });

    expect((await t3(buyer.token, `/${TRF}/accept`, {})).status).toBe(202);
    expect((await t3(officer.token, `/${TRF}/verify`, { note: 'Checked' })).status).toBe(202);
    expect((await t3(registrar.token, `/${TRF}/approve`, {})).status).toBe(202);
    expect((await t3(buyer.token, `/${TRF}/cancel`, { reason: 'Changed my mind' })).status).toBe(202);
    expect((await t3(officer.token, `/${TRF}/reject`, { reason: 'Forged agreement' })).status).toBe(202);
    expect((await t3(registrar.token, `/${TRF}/reject`, { reason: 'Valuation mismatch' })).status).toBe(202);
    expect(submit.mock.calls.map((c) => [c[1], c[2]])).toEqual([
      ['AcceptTransfer', [TRF]],
      ['VerifyTransfer', [TRF, 'Checked']],
      ['ApproveTransfer', [TRF, '']],
      ['CancelTransfer', [TRF, 'Changed my mind']],
      ['RejectTransfer', [TRF, 'Forged agreement']],
      ['RejectTransfer', [TRF, 'Valuation mismatch']],
    ]);

    // Wrong roles never reach the ledger.
    submit.mockClear();
    expect((await t3(officer.token, `/${TRF}/approve`, {})).status).toBe(403);
    expect((await t3(registrar.token, `/${TRF}/verify`, {})).status).toBe(403);
    expect((await t3(buyer.token, `/${TRF}/reject`, { reason: 'x reason' })).status).toBe(403);
    expect((await t3(officer.token, `/${TRF}/accept`, {})).status).toBe(403);
    expect((await t3(buyer.token, `/${TRF}/cancel`, {})).status).toBe(400);
    expect((await t3(buyer.token, '/TRF-nope/accept', {})).status).toBe(400);
    expect(submit).not.toHaveBeenCalled();
  });

  it('confirm-payments takes the hash of a receipt already attached to THIS transfer', async () => {
    const officer = await makeUser('LAND_OFFICER');
    await DocumentFile.create({ documentId: 'DOC-AAAAAAAAAAAAAAAA', sha256: 'c'.repeat(64), objectKey: 'k', mimeType: 'application/pdf', size: 1, targetType: 'TRANSFER', targetId: TRF, documentType: 'TAX_RECEIPT', uploadedBy: 'x' });
    await DocumentFile.create({ documentId: 'DOC-BBBBBBBBBBBBBBBB', sha256: 'b'.repeat(64), objectKey: 'k2', mimeType: 'application/pdf', size: 1, targetType: 'TRANSFER', targetId: 'TRF-FFFFFFFFFFFFFFFF', documentType: 'TAX_RECEIPT', uploadedBy: 'x' });
    submit.mockResolvedValue({ txId: TX, result: ledgerTransfer({ status: 'PAYMENTS_CONFIRMED' }) });

    const wrong = await t3(officer.token, `/${TRF}/confirm-payments`, { paymentReference: 'TRA-2026-1', evidenceDocumentId: 'DOC-BBBBBBBBBBBBBBBB' });
    expect(wrong.body.error.code).toBe('EVIDENCE_NOT_FOUND');
    const ok = await t3(officer.token, `/${TRF}/confirm-payments`, { paymentReference: 'TRA-2026-1', evidenceDocumentId: 'DOC-AAAAAAAAAAAAAAAA' });
    expect(ok.status).toBe(202);
    expect(submit.mock.calls.at(-1)?.slice(1, 3)).toEqual(['ConfirmPayments', [TRF, 'TRA-2026-1', 'c'.repeat(64)]]);
  });
});

describe('GET /transfers/:id', () => {
  it('parties see the sale price and both names; strangers and banks are refused', async () => {
    const seller = await makeUser('CITIZEN');
    const buyer = await makeUser('CITIZEN');
    const stranger = await makeUser('CITIZEN');
    const bank = await makeUser('BANK_OFFICER', { bankCode: 'CRDB' });
    evaluate.mockImplementation(async (_w, fn) =>
      fn === 'GetTransfer'
        ? ledgerTransfer({ sellerId: seller.user.userId, buyerId: buyer.user.userId })
        : { transferId: TRF, salePrice: 185_000_000, currency: 'TZS', sellerNidaRef: 'x', buyerNidaRef: 'y', sellerContactHash: 'h', buyerContactHash: 'h' },
    );
    const res = await api().get(`/api/v1/transfers/${TRF}`).set('Authorization', `Bearer ${buyer.token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.sale).toEqual({ salePrice: 185_000_000, currency: 'TZS' });
    expect(res.body.data.seller.fullName).toBe(seller.user.fullName);
    expect(res.body.data).not.toHaveProperty('buyerNidaHash');
    expect(JSON.stringify(res.body)).not.toContain('sellerNidaRef');

    expect((await api().get(`/api/v1/transfers/${TRF}`).set('Authorization', `Bearer ${stranger.token}`)).status).toBe(403);
    expect((await api().get(`/api/v1/transfers/${TRF}`).set('Authorization', `Bearer ${bank.token}`)).status).toBe(403);
  });

  it('support agents see the transfer but not the private sale price', async () => {
    const support = await makeUser('SUPPORT_AGENT');
    evaluate.mockResolvedValue(ledgerTransfer());
    const res = await api().get(`/api/v1/transfers/${TRF}`).set('Authorization', `Bearer ${support.token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.sale).toBeNull();
    expect(evaluate).toHaveBeenCalledTimes(1); // never asked for GetTransferPrivateDetails
  });

  it('a missing private record does not break the page', async () => {
    const officer = await makeUser('LAND_OFFICER');
    evaluate.mockImplementation(async (_w, fn) => {
      if (fn === 'GetTransfer') return ledgerTransfer();
      throw new AppError(404, 'NOT_FOUND', 'not on this peer');
    });
    const res = await api().get(`/api/v1/transfers/${TRF}`).set('Authorization', `Bearer ${officer.token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.sale).toBeNull();
  });
});

describe('GET /transfers (cache)', () => {
  it('citizens see transfers they are part of, filtered by side; officials filter by status', async () => {
    const me = await makeUser('CITIZEN');
    const officer = await makeUser('LAND_OFFICER');
    await TransferCache.insertMany([
      { transferId: 'TRF-0000000000000001', parcelId: 'DSM-KIN-1-1', sellerId: me.user.userId, buyerId: 'usr_b', status: 'INITIATED', ledgerUpdatedAt: new Date('2026-01-03') },
      { transferId: 'TRF-0000000000000002', parcelId: 'DSM-KIN-1-2', sellerId: 'usr_s', buyerId: me.user.userId, status: 'PAYMENTS_CONFIRMED', ledgerUpdatedAt: new Date('2026-01-02') },
      { transferId: 'TRF-0000000000000003', parcelId: 'DSM-KIN-1-3', sellerId: 'usr_s', buyerId: 'usr_b', status: 'PAYMENTS_CONFIRMED', ledgerUpdatedAt: new Date('2026-01-01') },
    ]);
    const ids = (r: { body: { data: { transferId: string }[] } }) => r.body.data.map((t) => t.transferId.slice(-1));
    const get = (token: string, qs = '') => api().get(`/api/v1/transfers${qs}`).set('Authorization', `Bearer ${token}`);

    expect(ids(await get(me.token))).toEqual(['1', '2']);
    expect(ids(await get(me.token, '?role=seller'))).toEqual(['1']);
    expect(ids(await get(me.token, '?role=buyer'))).toEqual(['2']);
    expect(ids(await get(me.token, '?q=1-2'))).toEqual(['2']);
    expect(ids(await get(officer.token, '?status=PAYMENTS_CONFIRMED&sort=updatedAt'))).toEqual(['3', '2']);
    expect(ids(await get(officer.token, '?parcelId=dsm-kin-1-3'))).toEqual(['3']);
    const bank = await makeUser('BANK_OFFICER');
    expect((await get(bank.token)).status).toBe(403);
  });
});

describe('GET /users/lookup', () => {
  it('lets a seller confirm the buyer by phone without exposing their details', async () => {
    const seller = await makeUser('CITIZEN');
    const buyer = await makeUser('CITIZEN', { fullName: 'Juma Hassan Mrisho' });
    const res = await api().get(`/api/v1/users/lookup?phone=${encodeURIComponent(buyer.user.phone)}`).set('Authorization', `Bearer ${seller.token}`);
    expect(res.body.data).toEqual({ userId: buyer.user.userId, displayName: 'Juma M.' });
    const none = await api().get('/api/v1/users/lookup?phone=0799999999').set('Authorization', `Bearer ${seller.token}`);
    expect(none.status).toBe(404);
    const support = await makeUser('SUPPORT_AGENT');
    expect((await api().get(`/api/v1/users/lookup?phone=${encodeURIComponent(buyer.user.phone)}`).set('Authorization', `Bearer ${support.token}`)).status).toBe(403);
  });
});
