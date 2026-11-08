import type { AuthUser } from '../../core/auth';
import { sha256Hex } from '../../core/crypto';
import { AppError, badRequest, notFound } from '../../core/errors';
import { ledger } from '../../core/fabric/ledger';
import { logger } from '../../core/logger';
import { getObjectBuffer, putObject, removeObject } from '../../core/storage';
import * as parcels from '../parcels/parcel.service';
import * as transfers from '../transfers/transfer.service';
import { toWalletUser } from '../users/user.service';
import { DocumentFile } from './document-file.model';
import type { UploadBody } from './document.schema';

export const MAX_FILE_BYTES = 10 * 1024 * 1024;

/** Accepted types, checked by content (magic bytes), not just by the declared MIME type. */
const SIGNATURES: { mime: string; ext: string; magic: number[] }[] = [
  { mime: 'application/pdf', ext: 'pdf', magic: [0x25, 0x50, 0x44, 0x46] }, // %PDF
  { mime: 'image/jpeg', ext: 'jpg', magic: [0xff, 0xd8, 0xff] },
  { mime: 'image/png', ext: 'png', magic: [0x89, 0x50, 0x4e, 0x47] },
];

export interface UploadedFile {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
}

interface LedgerDocumentRef {
  documentId: string;
  targetType: 'PARCEL' | 'TRANSFER';
  targetId: string;
  parcelId: string;
  documentType: string;
  sha256: string;
  version: number;
  status: 'ACTIVE' | 'SUPERSEDED';
  supersedes: string | null;
  supersededBy: string | null;
}

interface LedgerVerification {
  documentId: string;
  match: boolean;
  status: 'ACTIVE' | 'SUPERSEDED';
  version: number;
  latestDocumentId: string | null;
  parcelId: string;
  documentType: string;
}

export function sniff(file: UploadedFile): { mime: string; ext: string } {
  const sig = SIGNATURES.find((s) => s.magic.every((b, i) => file.buffer[i] === b));
  if (!sig) throw new AppError(415, 'UNSUPPORTED_FILE', 'Only PDF, JPEG and PNG files can be uploaded.');
  if (file.mimetype !== sig.mime) {
    throw new AppError(415, 'UNSUPPORTED_FILE', `The file content is ${sig.ext.toUpperCase()} but it was sent as ${file.mimetype}.`);
  }
  return sig;
}

/**
 * Hash check: the server computes SHA-256 itself; if the client sent the hash it computed before upload,
 * both must agree (catches corruption or tampering in transit).
 */
function fingerprint(file: UploadedFile, clientHash: string | undefined): string {
  const sha = sha256Hex(file.buffer);
  if (clientHash && clientHash !== sha) {
    throw new AppError(422, 'HASH_MISMATCH', 'The file changed during upload (its fingerprint does not match). Please try again.', {
      expected: clientHash,
      received: sha,
    });
  }
  return sha;
}

async function storeThenSubmit<T extends { documentId: string }>(
  file: UploadedFile,
  sha: string,
  objectKey: string,
  submit: () => Promise<{ txId: string; result: T }>,
): Promise<{ txId: string; result: T }> {
  const existing = await DocumentFile.exists({ objectKey });
  if (!existing) await putObject(objectKey, file.buffer, file.mimetype, { 'x-amz-meta-sha256': sha });
  try {
    return await submit();
  } catch (err) {
    // The ledger refused it — don't leave an orphaned object behind (unless another record points at it).
    if (!existing) await removeObject(objectKey).catch((e: Error) => logger.warn({ objectKey, err: e.message }, 'orphan cleanup failed'));
    throw err;
  }
}

/** Upload to MinIO, then record the hash on-chain with AttachDocument (rule 5). */
export async function upload(user: AuthUser, file: UploadedFile | undefined, body: UploadBody) {
  if (!file) throw badRequest('Attach the file as multipart field "file".', undefined, 'FILE_REQUIRED');
  const type = sniff(file);
  const sha = fingerprint(file, body.sha256);
  const objectKey = `${body.targetType.toLowerCase()}/${body.targetId}/${sha}.${type.ext}`;
  const payload = { targetType: body.targetType, targetId: body.targetId, documentType: body.documentType, sha256: sha };
  const { txId, result } = await storeThenSubmit(file, sha, objectKey, async () =>
    ledger.submit<LedgerDocumentRef>(await toWalletUser(user), 'AttachDocument', [JSON.stringify(payload)], {
      entityType: 'Document',
      entityId: body.targetId,
    }),
  );
  await DocumentFile.create({
    documentId: result.documentId,
    sha256: sha,
    objectKey,
    mimeType: file.mimetype,
    size: file.size,
    originalName: file.originalname,
    targetType: body.targetType,
    targetId: body.targetId,
    documentType: body.documentType,
    uploadedBy: user.userId,
    txId,
  });
  return { txId, documentId: result.documentId, sha256: sha };
}

/** New version of an existing document; the old hash stays on the ledger, marked SUPERSEDED. */
export async function supersede(user: AuthUser, documentId: string, file: UploadedFile | undefined, clientHash: string | undefined) {
  if (!file) throw badRequest('Attach the new version as multipart field "file".', undefined, 'FILE_REQUIRED');
  const old = await DocumentFile.findOne({ documentId, deletedAt: null });
  if (!old) throw notFound('That document was not uploaded through Milki.', 'DOCUMENT_NOT_FOUND');
  const type = sniff(file);
  const sha = fingerprint(file, clientHash);
  const objectKey = `${old.targetType.toLowerCase()}/${old.targetId}/${sha}.${type.ext}`;
  const { txId, result } = await storeThenSubmit(file, sha, objectKey, async () =>
    ledger.submit<LedgerDocumentRef>(await toWalletUser(user), 'SupersedeDocument', [documentId, sha], {
      entityType: 'Document',
      entityId: old.targetId,
    }),
  );
  await DocumentFile.create({
    documentId: result.documentId,
    sha256: sha,
    objectKey,
    mimeType: file.mimetype,
    size: file.size,
    originalName: file.originalname,
    targetType: old.targetType,
    targetId: old.targetId,
    documentType: old.documentType,
    version: result.version,
    supersedes: documentId,
    uploadedBy: user.userId,
    txId,
  });
  old.status = 'SUPERSEDED';
  await old.save();
  return { txId, documentId: result.documentId, supersedes: documentId, sha256: sha };
}

/** Viewing a document follows the visibility rules of what it is attached to. */
async function assertCanView(user: AuthUser, targetType: string, targetId: string): Promise<void> {
  if (targetType === 'PARCEL') await parcels.get(user, targetId);
  else await transfers.get(user, targetId);
}

/**
 * Streams nothing it cannot vouch for: the bytes from MinIO are re-hashed and checked against the hash
 * recorded on the ledger (rule 3) before they are sent.
 */
export async function download(user: AuthUser, documentId: string) {
  const meta = await DocumentFile.findOne({ documentId, deletedAt: null }).lean();
  if (!meta) throw notFound('That document was not uploaded through Milki.', 'DOCUMENT_NOT_FOUND');
  await assertCanView(user, meta.targetType, meta.targetId);
  const data = await getObjectBuffer(meta.objectKey);
  const sha = sha256Hex(data);
  const check = await ledger.evaluate<LedgerVerification>(await toWalletUser(user), 'VerifyDocument', [documentId, sha]);
  if (!check.match) {
    logger.error({ documentId, objectKey: meta.objectKey }, 'stored file does not match ledger hash');
    throw new AppError(409, 'INTEGRITY_FAILURE', 'This file no longer matches the fingerprint recorded on the ledger. It has been flagged for review.');
  }
  return { data, sha, meta, ledger: check };
}

/** Anyone signed in can check whether a file they hold is the one recorded on the ledger. */
export async function verifyFile(user: AuthUser, documentId: string, file: UploadedFile | undefined) {
  if (!file) throw badRequest('Attach the file to check as multipart field "file".', undefined, 'FILE_REQUIRED');
  const sha = sha256Hex(file.buffer);
  const check = await ledger.evaluate<LedgerVerification>(await toWalletUser(user), 'VerifyDocument', [documentId, sha]);
  return { ...check, sha256: sha };
}

/** Ledger document references for a parcel or transfer, enriched with file metadata from Mongo. */
export async function listForTarget(user: AuthUser, targetType: 'PARCEL' | 'TRANSFER', targetId: string) {
  const refs = await ledger.evaluate<LedgerDocumentRef[]>(await toWalletUser(user), 'GetDocuments', [targetType, targetId]);
  const files = await DocumentFile.find({ documentId: { $in: refs.map((r) => r.documentId) } }, { documentId: 1, mimeType: 1, size: 1, originalName: 1 }).lean();
  const byId = new Map(files.map((f) => [f.documentId, f]));
  return refs.map((r) => {
    const f = byId.get(r.documentId);
    return { ...r, file: f ? { mimeType: f.mimeType, size: f.size, name: f.originalName ?? null } : null };
  });
}
