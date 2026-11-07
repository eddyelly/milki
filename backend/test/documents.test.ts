import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../src/core/errors';
import { ledger } from '../src/core/fabric/ledger';
import { DocumentFile } from '../src/modules/documents/document-file.model';
import type { LedgerParcel } from '../src/modules/parcels/parcel.types';
import { api, idemKey, makeUser, reauth } from './helpers';
import { objects } from './outbox';

const evaluate = vi.mocked(ledger.evaluate);
const submit = vi.mocked(ledger.submit);
const TX = 'f'.repeat(64);
const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from('title deed for DSM-KIN-12-45')]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

async function upload(token: string, file: Buffer, fields: Record<string, string>, filename = 'deed.pdf', contentType = 'application/pdf') {
  let req = api().post('/api/v1/documents').set('Authorization', `Bearer ${token}`).set('Idempotency-Key', idemKey()).set('X-Reauth-Token', await reauth(token));
  for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
  return req.attach('file', file, { filename, contentType });
}

const fields = { targetType: 'PARCEL', targetId: 'DSM-KIN-12-45', documentType: 'TITLE_DEED' };

describe('POST /documents', () => {
  it('stores the file in MinIO, records only its SHA-256 on-chain, and returns 202', async () => {
    const owner = await makeUser('CITIZEN');
    submit.mockResolvedValueOnce({ txId: TX, result: { documentId: 'DOC-1111111111111111', version: 1 } });
    const res = await upload(owner.token, PDF, { ...fields, sha256: sha(PDF) });
    expect(res.status).toBe(202);
    expect(res.body.data).toEqual({ txId: TX, documentId: 'DOC-1111111111111111', sha256: sha(PDF), status: 'SUBMITTED' });

    const [, fn, args] = submit.mock.calls[0]!;
    expect(fn).toBe('AttachDocument');
    expect(JSON.parse(args[0]!)).toEqual({ targetType: 'PARCEL', targetId: 'DSM-KIN-12-45', documentType: 'TITLE_DEED', sha256: sha(PDF) });
    expect([...objects.keys()]).toEqual([`parcel/DSM-KIN-12-45/${sha(PDF)}.pdf`]);
    expect(await DocumentFile.findOne({ documentId: 'DOC-1111111111111111' }).lean()).toMatchObject({ size: PDF.length, mimeType: 'application/pdf', originalName: 'deed.pdf', status: 'SUBMITTED' });
  });

  it('rejects a hash mismatch (file changed in transit) before anything is stored', async () => {
    const owner = await makeUser('CITIZEN');
    const res = await upload(owner.token, PDF, { ...fields, sha256: 'a'.repeat(64) });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('HASH_MISMATCH');
    expect(objects.size).toBe(0);
    expect(submit).not.toHaveBeenCalled();
  });

  it('checks the real content type, not just the declared one', async () => {
    const owner = await makeUser('CITIZEN');
    const fake = await upload(owner.token, Buffer.from('MZ\x90\x00 not a pdf'), fields);
    expect(fake.status).toBe(415);
    const lying = await upload(owner.token, PNG, fields, 'deed.pdf', 'application/pdf');
    expect(lying.status).toBe(415);
    expect(lying.body.error.message).toContain('PNG');
    const png = await upload(owner.token, PNG, fields, 'plan.png', 'image/png');
    expect(png.status).not.toBe(415);
  });

  it('removes the object again when the ledger refuses the document', async () => {
    const stranger = await makeUser('CITIZEN');
    submit.mockRejectedValueOnce(new AppError(403, 'FORBIDDEN', 'You are not allowed to add documents to parcel DSM-KIN-12-45.'));
    const res = await upload(stranger.token, PDF, fields);
    expect(res.status).toBe(403);
    expect(res.body.error.message).toContain('not allowed');
    expect(objects.size).toBe(0);
    expect(await DocumentFile.countDocuments()).toBe(0);
  });

  it('validates fields and requires the file', async () => {
    const owner = await makeUser('CITIZEN');
    expect((await upload(owner.token, PDF, { ...fields, targetId: 'TRF-123' })).status).toBe(400);
    expect((await upload(owner.token, PDF, { ...fields, documentType: 'SELFIE' })).status).toBe(400);
    const noFile = await api()
      .post('/api/v1/documents')
      .set('Authorization', `Bearer ${owner.token}`)
      .set('Idempotency-Key', idemKey())
      .set('X-Reauth-Token', await reauth(owner.token))
      .field('targetType', 'PARCEL')
      .field('targetId', 'DSM-KIN-12-45')
      .field('documentType', 'TITLE_DEED');
    expect(noFile.body.error.code).toBe('FILE_REQUIRED');
    const support = await makeUser('SUPPORT_AGENT');
    expect((await api().post('/api/v1/documents').set('Authorization', `Bearer ${support.token}`).set('Idempotency-Key', idemKey())).status).toBe(403);
  });

  it('rejects files over 10 MB', async () => {
    const owner = await makeUser('CITIZEN');
    const big = Buffer.concat([Buffer.from('%PDF'), Buffer.alloc(10 * 1024 * 1024 + 1)]);
    const res = await upload(owner.token, big, fields);
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('FILE_TOO_LARGE');
  });
});

describe('supersede, download and verify', () => {
  async function seeded(ownerId: string) {
    const key = `parcel/DSM-KIN-12-45/${sha(PDF)}.pdf`;
    objects.set(key, PDF);
    await DocumentFile.create({ documentId: 'DOC-1111111111111111', sha256: sha(PDF), objectKey: key, mimeType: 'application/pdf', size: PDF.length, originalName: 'deed.pdf', targetType: 'PARCEL', targetId: 'DSM-KIN-12-45', documentType: 'TITLE_DEED', uploadedBy: ownerId });
  }
  const parcel = (ownerId: string) => ({ parcelId: 'DSM-KIN-12-45', ownerId, ownerNidaHash: 'x' }) as unknown as LedgerParcel;

  it('download re-hashes the bytes and checks them against the ledger before sending', async () => {
    const owner = await makeUser('CITIZEN');
    await seeded(owner.user.userId);
    evaluate.mockImplementation(async (_w, fn, args) => {
      if (fn === 'GetParcel') return parcel(owner.user.userId);
      if (fn === 'VerifyDocument') return { documentId: args?.[0], match: args?.[1] === sha(PDF), status: 'ACTIVE', version: 1, latestDocumentId: null };
      throw new Error(fn);
    });
    const res = await api().get('/api/v1/documents/DOC-1111111111111111/download').set('Authorization', `Bearer ${owner.token}`).buffer(true);
    expect(res.status).toBe(200);
    expect(res.headers['x-ledger-verified']).toBe('true');
    expect(res.headers['x-content-sha256']).toBe(sha(PDF));
    expect(res.headers['content-disposition']).toContain('deed.pdf');
    expect(Buffer.from(res.body as Buffer).equals(PDF)).toBe(true);

    // Someone swapped the stored object → refuse to serve it.
    objects.set(`parcel/DSM-KIN-12-45/${sha(PDF)}.pdf`, Buffer.from('%PDF tampered'));
    const bad = await api().get('/api/v1/documents/DOC-1111111111111111/download').set('Authorization', `Bearer ${owner.token}`);
    expect(bad.status).toBe(409);
    expect(bad.body.error.code).toBe('INTEGRITY_FAILURE');
  });

  it("download follows the target's visibility rules", async () => {
    const owner = await makeUser('CITIZEN');
    const other = await makeUser('CITIZEN');
    await seeded(owner.user.userId);
    evaluate.mockResolvedValue(parcel(owner.user.userId));
    expect((await api().get('/api/v1/documents/DOC-1111111111111111/download').set('Authorization', `Bearer ${other.token}`)).status).toBe(403);
    expect((await api().get('/api/v1/documents/DOC-9999999999999999/download').set('Authorization', `Bearer ${owner.token}`)).status).toBe(404);
  });

  it('supersede uploads v2 and keeps v1 (marked SUPERSEDED)', async () => {
    const owner = await makeUser('CITIZEN');
    await seeded(owner.user.userId);
    const v2 = Buffer.from('%PDF-1.7 corrected deed');
    submit.mockResolvedValueOnce({ txId: TX, result: { documentId: 'DOC-2222222222222222', version: 2 } });
    const res = await api()
      .post('/api/v1/documents/DOC-1111111111111111/supersede')
      .set('Authorization', `Bearer ${owner.token}`)
      .set('Idempotency-Key', idemKey())
      .set('X-Reauth-Token', await reauth(owner.token))
      .field('sha256', sha(v2))
      .attach('file', v2, { filename: 'deed-v2.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(202);
    expect(submit.mock.calls[0]?.slice(1, 3)).toEqual(['SupersedeDocument', ['DOC-1111111111111111', sha(v2)]]);
    expect(await DocumentFile.findOne({ documentId: 'DOC-2222222222222222' }).lean()).toMatchObject({ version: 2, supersedes: 'DOC-1111111111111111' });
    expect((await DocumentFile.findOne({ documentId: 'DOC-1111111111111111' }).lean())?.status).toBe('SUPERSEDED');
    expect(objects.size).toBe(2);
  });

  it('verify tells anyone signed in whether their copy matches the ledger', async () => {
    const bank = await makeUser('BANK_OFFICER', { bankCode: 'CRDB' });
    evaluate.mockImplementation(async (_w, _fn, args) => ({ documentId: args?.[0], match: args?.[1] === sha(PDF), status: 'ACTIVE', version: 1, latestDocumentId: null }));
    const good = await api().post('/api/v1/documents/DOC-1111111111111111/verify').set('Authorization', `Bearer ${bank.token}`).attach('file', PDF, 'copy.pdf');
    expect(good.body.data).toMatchObject({ match: true, sha256: sha(PDF) });
    const bad = await api().post('/api/v1/documents/DOC-1111111111111111/verify').set('Authorization', `Bearer ${bank.token}`).attach('file', Buffer.from('%PDF forged'), 'copy.pdf');
    expect(bad.body.data.match).toBe(false);
  });

  it('parcel document lists merge ledger references with file metadata', async () => {
    const owner = await makeUser('CITIZEN');
    await seeded(owner.user.userId);
    evaluate.mockImplementation(async (_w, fn) =>
      fn === 'GetParcel' ? parcel(owner.user.userId) : [{ documentId: 'DOC-1111111111111111', sha256: sha(PDF), status: 'ACTIVE' }],
    );
    const res = await api().get('/api/v1/parcels/DSM-KIN-12-45/documents').set('Authorization', `Bearer ${owner.token}`);
    expect(res.body.data[0]).toMatchObject({ documentId: 'DOC-1111111111111111', file: { mimeType: 'application/pdf', size: PDF.length, name: 'deed.pdf' } });
  });
});
