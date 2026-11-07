/**
 * The whole land transfer through the API on the live 3-org network: documents in MinIO with on-chain hashes,
 * private sale price, every role signing with its own Fabric identity, and notifications from chaincode events.
 */
import { createHash } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { API, call, signIn, sleep, t3, uploadDoc, waitCommitted } from './client';

type Session = { accessToken: string; user: { userId: string } };

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const rnd = () => Math.floor(100 + Math.random() * 899);

describe('land transfer end-to-end', () => {
  let registrar: Session;
  let officer: Session;
  let seller: Session;
  let buyer: Session;
  const parcelId = `DSM-TMK-${rnd()}-${rnd()}`;
  let transferId = '';
  let agreementId = '';
  const agreement = Buffer.from(`%PDF-1.7\nSale agreement for ${parcelId} ${Date.now()}`);
  const receipt = Buffer.from(`%PDF-1.7\nTRA receipt for ${parcelId} ${Date.now()}`);

  beforeAll(async () => {
    registrar = await signIn('registrar@milki.dev', '+255714000001');
    officer = await signIn('officer@milki.dev', '+255713000001');
    seller = await signIn('citizen@milki.dev', '+255712000001');
    buyer = await signIn('buyer@milki.dev', '+255712000002');

    const reg = await t3('POST', '/parcels', registrar.accessToken, {
      parcelId,
      titleNumber: `TF/${parcelId}`,
      region: 'Dar es Salaam',
      district: 'Temeke',
      ward: 'Kurasini',
      blockNumber: '3',
      plotNumber: '18',
      area: 450,
      landUse: 'RESIDENTIAL',
      location: { latitude: -6.8701, longitude: 39.2811 },
      owner: { userId: seller.user.userId },
    });
    expect(reg.status).toBe(202);
    await waitCommitted(registrar.accessToken, reg.body.data.txId);
  });

  it('seller attaches the sale agreement: file in MinIO, SHA-256 on-chain', async () => {
    const up = await uploadDoc(seller.accessToken, '/documents', { targetType: 'PARCEL', targetId: parcelId, documentType: 'SALE_AGREEMENT', sha256: sha(agreement) }, agreement, 'agreement.pdf', 'application/pdf');
    expect(up.status).toBe(202);
    expect(up.body.data.sha256).toBe(sha(agreement));
    agreementId = up.body.data.documentId;
    await waitCommitted(seller.accessToken, up.body.data.txId);
  });

  it('seller initiates the transfer to the buyer by phone; the price goes to private data', async () => {
    const lookup = await call<{ userId: string; displayName: string }>('GET', '/users/lookup?phone=0712000002', { token: seller.accessToken });
    expect(lookup.body.data).toMatchObject({ userId: buyer.user.userId, displayName: 'Juma H.' });

    const res = await t3('POST', '/transfers', seller.accessToken, { parcelId, buyer: { phone: '0712000002' }, salePrice: 185_000_000, currency: 'TZS' });
    expect(res.status).toBe(202);
    transferId = (res.body.data as unknown as { transferId: string }).transferId;
    expect(transferId).toMatch(/^TRF-[A-F0-9]{16}$/);
    await waitCommitted(seller.accessToken, res.body.data.txId);

    const asBuyer = await call<{ status: string; sale: { salePrice: number } | null; seller: { fullName: string } }>('GET', `/transfers/${transferId}`, { token: buyer.accessToken });
    expect(asBuyer.body.data).toMatchObject({ status: 'INITIATED', sale: { salePrice: 185_000_000 }, seller: { fullName: 'Asha Mwakyusa' } });
    const p = await call<{ status: string }>('GET', `/parcels/${parcelId}`, { token: registrar.accessToken });
    expect(p.body.data.status).toBe('PENDING_TRANSFER');
  });

  it('a second transfer of the same parcel is refused by the chaincode', async () => {
    const res = await t3('POST', '/transfers', seller.accessToken, { parcelId, buyer: { phone: '0712000002' }, salePrice: 1 });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'TRANSFER_IN_PROGRESS', message: `Parcel ${parcelId} already has a transfer in progress.` });
  });

  it('buyer accepts and uploads proof of payment to the transfer', async () => {
    const acc = await t3('POST', `/transfers/${transferId}/accept`, buyer.accessToken, {});
    expect(acc.status).toBe(202);
    await waitCommitted(buyer.accessToken, acc.body.data.txId);
    const up = await uploadDoc(buyer.accessToken, '/documents', { targetType: 'TRANSFER', targetId: transferId, documentType: 'TAX_RECEIPT' }, receipt, 'tra-receipt.pdf', 'application/pdf');
    expect(up.status).toBe(202);
    await waitCommitted(buyer.accessToken, up.body.data.txId);
    (globalThis as Record<string, unknown>).receiptId = up.body.data.documentId;
  });

  it('land officer (Org2) confirms payments with the receipt and verifies; sees the private price', async () => {
    const receiptId = (globalThis as Record<string, unknown>).receiptId as string;
    const conf = await t3('POST', `/transfers/${transferId}/confirm-payments`, officer.accessToken, { paymentReference: 'TRA-2026-77881', evidenceDocumentId: receiptId });
    expect(conf.status).toBe(202);
    await waitCommitted(officer.accessToken, conf.body.data.txId);

    const view = await call<{ status: string; paymentEvidenceHash: string; sale: { salePrice: number } }>('GET', `/transfers/${transferId}`, { token: officer.accessToken });
    expect(view.body.data).toMatchObject({ status: 'PAYMENTS_CONFIRMED', paymentEvidenceHash: sha(receipt), sale: { salePrice: 185_000_000 } });

    const ver = await t3('POST', `/transfers/${transferId}/verify`, officer.accessToken, { note: 'Agreement and TRA receipt checked' });
    await waitCommitted(officer.accessToken, ver.body.data.txId);
  });

  it('the seller can no longer cancel once verified', async () => {
    const res = await t3('POST', `/transfers/${transferId}/cancel`, seller.accessToken, { reason: 'Changed my mind' });
    expect(res.status).toBe(409);
    expect(res.body.error?.message).toContain('already been verified by a land officer');
  });

  it('registrar approves: ownership moves to the buyer', async () => {
    const res = await t3('POST', `/transfers/${transferId}/approve`, registrar.accessToken, { note: 'Approved' });
    expect(res.status).toBe(202);
    await waitCommitted(registrar.accessToken, res.body.data.txId);

    const p = await call<{ status: string; owner: { userId: string }; ownershipVersion: number }>('GET', `/parcels/${parcelId}`, { token: registrar.accessToken });
    expect(p.body.data).toMatchObject({ status: 'ACTIVE', owner: { userId: buyer.user.userId }, ownershipVersion: 2 });
    const t = await call<{ status: string; history: { status: string; by: { mspId: string } }[] }>('GET', `/transfers/${transferId}`, { token: buyer.accessToken });
    expect(t.body.data.history.map((h) => `${h.status}@${h.by.mspId}`)).toEqual([
      'INITIATED@Org1MSP',
      'BUYER_ACCEPTED@Org1MSP',
      'PAYMENTS_CONFIRMED@Org2MSP',
      'OFFICER_VERIFIED@Org2MSP',
      'APPROVED@Org1MSP',
      'COMPLETED@Org1MSP',
    ]);
    // The new owner can now see the parcel; the old owner cannot.
    expect((await call('GET', `/parcels/${parcelId}`, { token: buyer.accessToken })).status).toBe(200);
    expect((await call('GET', `/parcels/${parcelId}`, { token: seller.accessToken })).status).toBe(403);
  });

  it('event listener: transfer cache, notifications in each party’s inbox', async () => {
    for (let i = 0; i < 40; i++) {
      const list = await call<{ transferId: string; status: string }[]>('GET', `/transfers?q=${transferId}`, { token: buyer.accessToken });
      if (list.body.data[0]?.status === 'COMPLETED') break;
      await sleep(250);
    }
    const list = await call<{ status: string }[]>('GET', `/transfers?q=${transferId}`, { token: buyer.accessToken });
    expect(list.body.data[0]?.status).toBe('COMPLETED');

    const inbox = await call<{ type: string; data: { transferId?: string } }[]>('GET', '/notifications?limit=50', { token: buyer.accessToken });
    const mine = inbox.body.data.filter((n) => n.data.transferId === transferId).map((n) => n.type);
    expect(mine).toEqual(expect.arrayContaining(['Transfer.Initiated', 'Transfer.PaymentsConfirmed', 'Transfer.Verified', 'Transfer.Approved']));
    const sellerInbox = await call<{ type: string; body: string; data: { transferId?: string } }[]>('GET', '/notifications?limit=50', { token: seller.accessToken });
    expect(sellerInbox.body.data.find((n) => n.data.transferId === transferId && n.type === 'Transfer.Approved')?.body).toContain('Juma H.');
  });

  it('documents download only after a ledger hash check, and the new owner can see the parcel’s', async () => {
    const res = await fetch(`${API}/documents/${agreementId}/download`, { headers: { authorization: `Bearer ${buyer.accessToken}` } });
    expect(res.status).toBe(200);
    expect(res.headers.get('x-ledger-verified')).toBe('true');
    expect(Buffer.from(await res.arrayBuffer()).equals(agreement)).toBe(true);

    const docs = await call<{ documentId: string; file: { name: string } }[]>('GET', `/parcels/${parcelId}/documents`, { token: buyer.accessToken });
    expect(docs.body.data.find((d) => d.documentId === agreementId)?.file.name).toBe('agreement.pdf');
  });
});
