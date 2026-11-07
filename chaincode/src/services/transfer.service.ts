import type { Context } from 'fabric-contract-api';
import { conflict, forbidden, invalid, invalidState, notFound } from '../errors';
import { getActor, isRole, requireRole } from '../identity';
import { emit, fromBytes, KEYS, type Page, PRIVATE_COLLECTION, queryPage, readState, toBytes, txTime, newId } from '../ledger';
import {
  type ActorRef,
  TERMINAL_TRANSFER_STATUSES,
  type Transfer,
  type TransferPrivateDetails,
  type TransferStatus,
} from '../models';
import * as v from '../validation';
import { assertTransferable, loadParcel, loadTransfer, saveParcel, saveTransfer, created } from './common';
import { parseListQuery } from './parcel.service';

/** Transient map key carrying the private sale details for InitiateTransfer. */
export const TRANSIENT_KEY = 'transfer';

const STATUS_PHRASE: Readonly<Record<TransferStatus, string>> = {
  INITIATED: 'waiting for the buyer to accept',
  BUYER_ACCEPTED: 'waiting for payment confirmation',
  PAYMENTS_CONFIRMED: 'waiting for a land officer to verify it',
  OFFICER_VERIFIED: 'waiting for registrar approval',
  APPROVED: 'already approved',
  COMPLETED: 'already completed',
  CANCELLED: 'cancelled',
  REJECTED: 'rejected',
};

/** States from which the seller may still cancel ("before verification"). */
const CANCELLABLE: readonly TransferStatus[] = ['INITIATED', 'BUYER_ACCEPTED', 'PAYMENTS_CONFIRMED'];

function expectStatus(t: Transfer, expected: TransferStatus, verb: string): void {
  if (t.status !== expected) {
    throw invalidState(`This transfer cannot be ${verb} because it is ${STATUS_PHRASE[t.status]}.`, {
      transferId: t.transferId,
      status: t.status,
      expected,
    });
  }
}

function step(ctx: Context, actor: ActorRef, t: Transfer, status: TransferStatus, note: string | null): void {
  t.status = status;
  t.history.push({ status, at: txTime(ctx), by: actor, txId: ctx.stub.getTxID(), note });
}

function transferEvent(ctx: Context, actor: ActorRef, t: Transfer, action: string, extra: Record<string, string | number | null> = {}): void {
  emit(ctx, {
    entity: 'Transfer',
    action,
    id: t.transferId,
    parcelId: t.parcelId,
    status: t.status,
    actor,
    data: { sellerId: t.sellerId, buyerId: t.buyerId, ...extra },
  });
}

function readPrivateInput(ctx: Context): Omit<TransferPrivateDetails, 'transferId'> {
  const bytes = ctx.stub.getTransient().get(TRANSIENT_KEY);
  if (!bytes || bytes.length === 0) {
    throw invalid('Sale details (price and party references) are required and must be sent privately.');
  }
  const input = v.parseObject(new TextDecoder().decode(bytes), 'private sale details');
  v.onlyKeys(input, ['salePrice', 'currency', 'sellerNidaRef', 'buyerNidaRef', 'sellerContactHash', 'buyerContactHash'], 'private sale details');
  return {
    salePrice: v.num(input.salePrice, 'salePrice', { positive: true }),
    currency: v.str(input.currency, 'currency', { pattern: v.CURRENCY_RE, patternHint: 'ISO code, e.g. TZS', max: 3 }),
    sellerNidaRef: v.str(input.sellerNidaRef, 'sellerNidaRef', { max: 64 }),
    buyerNidaRef: v.str(input.buyerNidaRef, 'buyerNidaRef', { max: 64 }),
    sellerContactHash: v.sha256(input.sellerContactHash, 'sellerContactHash'),
    buyerContactHash: v.sha256(input.buyerContactHash, 'buyerContactHash'),
  };
}

/** Owner starts a sale. Price and NIDA references go to the private collection via the transient map. */
export async function initiateTransfer(ctx: Context, parcelIdArg: string, buyerIdArg: string, buyerNidaHashArg: string): Promise<Transfer> {
  const actor = getActor(ctx);
  requireRole(actor, ['CITIZEN'], 'start a land transfer');
  const parcel = await loadParcel(ctx, v.parcelId(parcelIdArg));
  if (actor.id !== parcel.ownerId) {
    throw forbidden(`Only the registered owner of parcel ${parcel.parcelId} can start a transfer.`);
  }
  const buyerId = v.userId(buyerIdArg, 'buyerId');
  const buyerNidaHash = v.sha256(buyerNidaHashArg, 'buyerNidaHash');
  if (buyerId === parcel.ownerId || buyerNidaHash === parcel.ownerNidaHash) {
    throw invalid('You cannot transfer a parcel to yourself.');
  }
  await assertTransferable(ctx, parcel, null);
  const privateInput = readPrivateInput(ctx);

  const transferId = newId(ctx, 'TRF');
  if (await readState(ctx, KEYS.transfer(transferId))) throw conflict(`Transfer ${transferId} already exists.`);

  const transfer: Transfer = {
    docType: 'transfer',
    transferId,
    parcelId: parcel.parcelId,
    sellerId: parcel.ownerId,
    buyerId,
    buyerNidaHash,
    ownershipVersion: parcel.ownershipVersion,
    status: 'INITIATED',
    paymentReference: null,
    paymentEvidenceHash: null,
    verifiedBy: null,
    approvedBy: null,
    closedReason: null,
    documentIds: [],
    history: [],
    ...created(ctx, actor),
  };
  step(ctx, actor, transfer, 'INITIATED', null);

  parcel.activeTransferId = transferId;
  parcel.transferIds.push(transferId);
  await saveParcel(ctx, actor, parcel);
  await saveTransfer(ctx, actor, transfer);
  const details: TransferPrivateDetails = { transferId, ...privateInput };
  await ctx.stub.putPrivateData(PRIVATE_COLLECTION, KEYS.transfer(transferId), toBytes(details));

  transferEvent(ctx, actor, transfer, 'Initiated');
  return transfer;
}

export async function acceptTransfer(ctx: Context, transferIdArg: string): Promise<Transfer> {
  const actor = getActor(ctx);
  requireRole(actor, ['CITIZEN'], 'accept a transfer');
  const t = await loadTransfer(ctx, v.entityId(transferIdArg, 'transferId'));
  if (actor.id !== t.buyerId) throw forbidden('Only the buyer named on this transfer can accept it.');
  expectStatus(t, 'INITIATED', 'accepted');
  await assertTransferable(ctx, await loadParcel(ctx, t.parcelId), t.transferId);
  step(ctx, actor, t, 'BUYER_ACCEPTED', null);
  await saveTransfer(ctx, actor, t);
  transferEvent(ctx, actor, t, 'Accepted');
  return t;
}

/** A land officer confirms the purchase price and government fees (TRA, mocked) against the receipts. */
export async function confirmPayments(ctx: Context, transferIdArg: string, paymentRefArg: string, evidenceHashArg: string): Promise<Transfer> {
  const actor = getActor(ctx);
  requireRole(actor, ['LAND_OFFICER'], 'confirm payments');
  const t = await loadTransfer(ctx, v.entityId(transferIdArg, 'transferId'));
  const paymentReference = v.str(paymentRefArg, 'paymentReference', { max: 80 });
  const paymentEvidenceHash = v.sha256(evidenceHashArg, 'paymentEvidenceHash');
  expectStatus(t, 'BUYER_ACCEPTED', 'marked as paid');
  await assertTransferable(ctx, await loadParcel(ctx, t.parcelId), t.transferId);
  t.paymentReference = paymentReference;
  t.paymentEvidenceHash = paymentEvidenceHash;
  step(ctx, actor, t, 'PAYMENTS_CONFIRMED', null);
  await saveTransfer(ctx, actor, t);
  transferEvent(ctx, actor, t, 'PaymentsConfirmed', { paymentReference });
  return t;
}

function assertSellerStillOwns(t: Transfer, ownerId: string, ownershipVersion: number): void {
  if (ownerId !== t.sellerId || ownershipVersion !== t.ownershipVersion) {
    throw invalidState('Ownership of this parcel has changed since the transfer started. Please reject this transfer.');
  }
}

export async function verifyTransfer(ctx: Context, transferIdArg: string, noteArg: string): Promise<Transfer> {
  const actor = getActor(ctx);
  requireRole(actor, ['LAND_OFFICER'], 'verify transfers');
  const t = await loadTransfer(ctx, v.entityId(transferIdArg, 'transferId'));
  const note = v.optStr(noteArg, 'note', { max: 500 });
  expectStatus(t, 'PAYMENTS_CONFIRMED', 'verified');
  const parcel = await loadParcel(ctx, t.parcelId);
  await assertTransferable(ctx, parcel, t.transferId);
  assertSellerStillOwns(t, parcel.ownerId, parcel.ownershipVersion);
  t.verifiedBy = actor;
  step(ctx, actor, t, 'OFFICER_VERIFIED', note);
  await saveTransfer(ctx, actor, t);
  transferEvent(ctx, actor, t, 'Verified');
  return t;
}

/** Registrar's final approval. Moves ownership in the same transaction: APPROVED → COMPLETED. */
export async function approveTransfer(ctx: Context, transferIdArg: string, noteArg: string): Promise<Transfer> {
  const actor = getActor(ctx);
  requireRole(actor, ['REGISTRAR'], 'approve transfers');
  const t = await loadTransfer(ctx, v.entityId(transferIdArg, 'transferId'));
  const note = v.optStr(noteArg, 'note', { max: 500 });
  expectStatus(t, 'OFFICER_VERIFIED', 'approved');
  if (!t.verifiedBy || t.verifiedBy.role === actor.role || t.verifiedBy.id === actor.id) {
    throw forbidden('The approver must hold a different role from the officer who verified this transfer.');
  }
  const parcel = await loadParcel(ctx, t.parcelId);
  await assertTransferable(ctx, parcel, t.transferId);
  assertSellerStillOwns(t, parcel.ownerId, parcel.ownershipVersion);

  t.approvedBy = actor;
  step(ctx, actor, t, 'APPROVED', note);
  parcel.ownerId = t.buyerId;
  parcel.ownerNidaHash = t.buyerNidaHash;
  parcel.ownershipVersion += 1;
  parcel.activeTransferId = null;
  step(ctx, actor, t, 'COMPLETED', null);

  await saveParcel(ctx, actor, parcel);
  await saveTransfer(ctx, actor, t);
  transferEvent(ctx, actor, t, 'Approved', {
    previousOwnerId: t.sellerId,
    newOwnerId: t.buyerId,
    ownershipVersion: parcel.ownershipVersion,
  });
  return t;
}

async function closeTransfer(ctx: Context, actor: ActorRef, t: Transfer, status: 'CANCELLED' | 'REJECTED', why: string): Promise<Transfer> {
  t.closedReason = why;
  step(ctx, actor, t, status, why);
  const parcel = await loadParcel(ctx, t.parcelId);
  if (parcel.activeTransferId === t.transferId) {
    parcel.activeTransferId = null;
    await saveParcel(ctx, actor, parcel);
  }
  await saveTransfer(ctx, actor, t);
  transferEvent(ctx, actor, t, status === 'CANCELLED' ? 'Cancelled' : 'Rejected', { reason: why });
  return t;
}

export async function cancelTransfer(ctx: Context, transferIdArg: string, reasonArg: string): Promise<Transfer> {
  const actor = getActor(ctx);
  requireRole(actor, ['CITIZEN'], 'cancel a transfer');
  const t = await loadTransfer(ctx, v.entityId(transferIdArg, 'transferId'));
  if (actor.id !== t.sellerId) throw forbidden('Only the seller can cancel this transfer.');
  const why = v.reason(reasonArg);
  if (!CANCELLABLE.includes(t.status)) {
    const msg = TERMINAL_TRANSFER_STATUSES.includes(t.status)
      ? `This transfer is ${STATUS_PHRASE[t.status]}.`
      : 'This transfer has already been verified by a land officer and can no longer be cancelled. Ask the registry to reject it instead.';
    throw invalidState(msg, { status: t.status });
  }
  return closeTransfer(ctx, actor, t, 'CANCELLED', why);
}

export async function rejectTransfer(ctx: Context, transferIdArg: string, reasonArg: string): Promise<Transfer> {
  const actor = getActor(ctx);
  requireRole(actor, ['LAND_OFFICER', 'REGISTRAR'], 'reject transfers');
  const t = await loadTransfer(ctx, v.entityId(transferIdArg, 'transferId'));
  const why = v.reason(reasonArg);
  if (TERMINAL_TRANSFER_STATUSES.includes(t.status) || t.status === 'APPROVED') {
    throw invalidState(`This transfer is ${STATUS_PHRASE[t.status]}.`, { status: t.status });
  }
  if (t.status === 'OFFICER_VERIFIED' && !isRole(actor, 'REGISTRAR')) {
    throw forbidden('Once a transfer is verified, only a registrar can reject it.');
  }
  return closeTransfer(ctx, actor, t, 'REJECTED', why);
}

export async function getTransfer(ctx: Context, transferIdArg: string): Promise<Transfer> {
  return loadTransfer(ctx, v.entityId(transferIdArg, 'transferId'));
}

export async function queryTransfers(ctx: Context, rawQuery: string, size: string, bookmark: string): Promise<Page<Transfer>> {
  const q = parseListQuery(rawQuery);
  return queryPage<Transfer>(ctx, 'transfer', q.selector, q.sort, v.pageSize(size), bookmark ?? '');
}

/** Sale price & references. Parties and officials only; the collection itself is Org1 + Org2 only. */
export async function getTransferPrivateDetails(ctx: Context, transferIdArg: string): Promise<TransferPrivateDetails> {
  const actor = getActor(ctx);
  const t = await loadTransfer(ctx, v.entityId(transferIdArg, 'transferId'));
  const isParty = isRole(actor, 'CITIZEN') && (actor.id === t.sellerId || actor.id === t.buyerId);
  if (!isParty && !isRole(actor, 'LAND_OFFICER', 'REGISTRAR')) {
    throw forbidden('Only the parties to this transfer and land officials can see its sale details.');
  }
  const bytes = await ctx.stub.getPrivateData(PRIVATE_COLLECTION, KEYS.transfer(t.transferId));
  if (!bytes || bytes.length === 0) throw notFound('The private sale details for this transfer are not available on this peer.');
  return fromBytes<TransferPrivateDetails>(bytes);
}
