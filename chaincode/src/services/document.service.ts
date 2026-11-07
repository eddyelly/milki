import type { Context } from 'fabric-contract-api';
import { conflict, forbidden, invalid, invalidState } from '../errors';
import { getActor, getBankCode, isRole, requireRole } from '../identity';
import { emit, KEYS, mustRead, newId, readState, writeState } from '../ledger';
import {
  type ActorRef,
  DOCUMENT_TYPES,
  type DocumentRef,
  type DocumentTargetType,
  type DocumentType,
  type Encumbrance,
  type Parcel,
  TERMINAL_TRANSFER_STATUSES,
  type Transfer,
} from '../models';
import * as v from '../validation';
import { assertNotRetired, created, loadParcel, loadTransfer, saveParcel, saveTransfer, stamp } from './common';

const TARGET_TYPES: readonly DocumentTargetType[] = ['PARCEL', 'TRANSFER'];

type Target = { type: 'PARCEL'; parcel: Parcel } | { type: 'TRANSFER'; transfer: Transfer };

const loadDocument = (ctx: Context, id: string): Promise<DocumentRef> =>
  mustRead<DocumentRef>(ctx, KEYS.document(id), `Document ${id} was not found.`);

async function loadTarget(ctx: Context, type: DocumentTargetType, id: string): Promise<Target> {
  if (type === 'PARCEL') return { type, parcel: await loadParcel(ctx, v.parcelId(id)) };
  return { type, transfer: await loadTransfer(ctx, v.entityId(id, 'targetId')) };
}

const targetParcelId = (t: Target): string => (t.type === 'PARCEL' ? t.parcel.parcelId : t.transfer.parcelId);
const targetDocIds = (t: Target): string[] => (t.type === 'PARCEL' ? t.parcel.documentIds : t.transfer.documentIds);

/**
 * Who may add/replace documents:
 *  - PARCEL: registrar, land officer, the owner (citizen), or a bank officer adding a MORTGAGE_DEED for a
 *    parcel on which their bank holds an active encumbrance.
 *  - TRANSFER (while open): registrar, land officer, seller or buyer.
 */
async function assertCanWrite(ctx: Context, actor: ActorRef, target: Target, documentType: DocumentType): Promise<void> {
  if (target.type === 'PARCEL') {
    assertNotRetired(target.parcel);
    if (isRole(actor, 'REGISTRAR', 'LAND_OFFICER')) return;
    if (isRole(actor, 'CITIZEN') && actor.id === target.parcel.ownerId) return;
    if (isRole(actor, 'BANK_OFFICER') && documentType === 'MORTGAGE_DEED') {
      const bankCode = getBankCode(ctx);
      for (const id of target.parcel.activeEncumbranceIds) {
        const enc = await readState<Encumbrance>(ctx, KEYS.encumbrance(id));
        if (enc && enc.lenderCode === bankCode) return;
      }
    }
    throw forbidden(`You are not allowed to add documents to parcel ${target.parcel.parcelId}.`);
  }
  const t = target.transfer;
  if (TERMINAL_TRANSFER_STATUSES.includes(t.status)) {
    throw invalidState('Documents cannot be added to a transfer that is already closed.');
  }
  if (isRole(actor, 'REGISTRAR', 'LAND_OFFICER')) return;
  if (isRole(actor, 'CITIZEN') && (actor.id === t.sellerId || actor.id === t.buyerId)) return;
  throw forbidden('Only the parties to this transfer and land officials can add documents to it.');
}

async function saveTarget(ctx: Context, actor: ActorRef, target: Target): Promise<void> {
  if (target.type === 'PARCEL') await saveParcel(ctx, actor, target.parcel);
  else await saveTransfer(ctx, actor, target.transfer);
}

function event(ctx: Context, actor: ActorRef, d: DocumentRef, action: string): void {
  emit(ctx, {
    entity: 'Document',
    action,
    id: d.documentId,
    parcelId: d.parcelId,
    status: d.status,
    actor,
    data: { targetType: d.targetType, targetId: d.targetId, documentType: d.documentType, sha256: d.sha256, version: d.version },
  });
}

/** Records a file's SHA-256 against a parcel or transfer. The file itself lives in MinIO (rule 5). */
export async function attachDocument(ctx: Context, raw: string): Promise<DocumentRef> {
  const actor = getActor(ctx);
  requireRole(actor, ['CITIZEN', 'LAND_OFFICER', 'REGISTRAR', 'BANK_OFFICER'], 'attach documents');
  const input = v.parseObject(raw, 'document');
  v.onlyKeys(input, ['targetType', 'targetId', 'documentType', 'sha256'], 'document');
  const targetType = v.oneOf(input.targetType, TARGET_TYPES, 'targetType');
  const documentType = v.oneOf(input.documentType, DOCUMENT_TYPES, 'documentType');
  const hash = v.sha256(input.sha256, 'sha256');
  const target = await loadTarget(ctx, targetType, v.str(input.targetId, 'targetId', { max: 40 }));
  await assertCanWrite(ctx, actor, target, documentType);

  for (const id of targetDocIds(target)) {
    const existing = await readState<DocumentRef>(ctx, KEYS.document(id));
    if (existing && existing.status === 'ACTIVE' && existing.sha256 === hash) {
      throw conflict(`This exact file is already attached as document ${existing.documentId}.`, { documentId: existing.documentId });
    }
  }

  const documentId = newId(ctx, 'DOC');
  if (await readState(ctx, KEYS.document(documentId))) throw conflict(`Document ${documentId} already exists.`);
  const doc: DocumentRef = {
    docType: 'document',
    documentId,
    targetType,
    targetId: target.type === 'PARCEL' ? target.parcel.parcelId : target.transfer.transferId,
    parcelId: targetParcelId(target),
    documentType,
    sha256: hash,
    version: 1,
    rootDocumentId: documentId,
    supersedes: null,
    supersededBy: null,
    status: 'ACTIVE',
    ...created(ctx, actor),
  };
  targetDocIds(target).push(documentId);
  await saveTarget(ctx, actor, target);
  await writeState(ctx, KEYS.document(documentId), doc);
  event(ctx, actor, doc, 'Attached');
  return doc;
}

/** New version of a document. The old record and hash stay on the ledger, marked SUPERSEDED. */
export async function supersedeDocument(ctx: Context, documentIdArg: string, sha256Arg: string): Promise<DocumentRef> {
  const actor = getActor(ctx);
  requireRole(actor, ['CITIZEN', 'LAND_OFFICER', 'REGISTRAR', 'BANK_OFFICER'], 'replace documents');
  const old = await loadDocument(ctx, v.entityId(documentIdArg, 'documentId'));
  const hash = v.sha256(sha256Arg, 'sha256');
  if (old.status !== 'ACTIVE') {
    throw invalidState(`This document was already replaced by ${old.supersededBy ?? 'a newer version'}.`);
  }
  if (old.sha256 === hash) throw invalid('The new file is identical to the current version.');
  const target = await loadTarget(ctx, old.targetType, old.targetId);
  await assertCanWrite(ctx, actor, target, old.documentType);

  const documentId = newId(ctx, 'DOC');
  if (await readState(ctx, KEYS.document(documentId))) throw conflict(`Document ${documentId} already exists.`);
  const next: DocumentRef = {
    ...old,
    documentId,
    sha256: hash,
    version: old.version + 1,
    supersedes: old.documentId,
    supersededBy: null,
    status: 'ACTIVE',
    ...created(ctx, actor),
  };
  old.status = 'SUPERSEDED';
  old.supersededBy = documentId;
  stamp(ctx, actor, old);

  targetDocIds(target).push(documentId);
  await saveTarget(ctx, actor, target);
  await writeState(ctx, KEYS.document(old.documentId), old);
  await writeState(ctx, KEYS.document(documentId), next);
  event(ctx, actor, next, 'Superseded');
  return next;
}

export async function getDocuments(ctx: Context, targetTypeArg: string, targetIdArg: string): Promise<DocumentRef[]> {
  const targetType = v.oneOf(targetTypeArg, TARGET_TYPES, 'targetType');
  const target = await loadTarget(ctx, targetType, targetIdArg);
  const out: DocumentRef[] = [];
  for (const id of targetDocIds(target)) {
    const d = await readState<DocumentRef>(ctx, KEYS.document(id));
    if (d) out.push(d);
  }
  return out;
}

export interface DocumentVerification {
  documentId: string;
  match: boolean;
  status: DocumentRef['status'];
  version: number;
  latestDocumentId: string | null;
  parcelId: string;
  documentType: DocumentType;
}

/** For QR / upload verification: does this hash match what the ledger recorded? */
export async function verifyDocument(ctx: Context, documentIdArg: string, sha256Arg: string): Promise<DocumentVerification> {
  const doc = await loadDocument(ctx, v.entityId(documentIdArg, 'documentId'));
  const hash = v.sha256(sha256Arg, 'sha256');
  return {
    documentId: doc.documentId,
    match: doc.sha256 === hash,
    status: doc.status,
    version: doc.version,
    latestDocumentId: doc.supersededBy,
    parcelId: doc.parcelId,
    documentType: doc.documentType,
  };
}
