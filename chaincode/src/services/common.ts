import type { Context } from 'fabric-contract-api';
import { MilkiError } from '../errors';
import { KEYS, mustRead, readState, txTime, writeState } from '../ledger';
import type { ActorRef, Encumbrance, Parcel, ParcelStatus, Transfer } from '../models';

interface Stamped {
  updatedAt: string;
  updatedBy: ActorRef;
  lastTxId: string;
}

/** Sets the audit fields every on-chain record carries. */
export function stamp<T extends Stamped>(ctx: Context, actor: ActorRef, entity: T): T {
  entity.updatedAt = txTime(ctx);
  entity.updatedBy = actor;
  entity.lastTxId = ctx.stub.getTxID();
  return entity;
}

/** Fields for a brand-new record. */
export function created(ctx: Context, actor: ActorRef) {
  const at = txTime(ctx);
  const txId = ctx.stub.getTxID();
  return { createdAt: at, createdBy: actor, updatedAt: at, updatedBy: actor, lastTxId: txId };
}

/**
 * Status precedence: RETIRED > FROZEN > DISPUTED > ENCUMBERED > PENDING_TRANSFER > ACTIVE.
 * Status is always derived from the underlying facts so that, e.g., a parcel that is both mortgaged
 * and disputed never loses either fact.
 */
export function deriveParcelStatus(p: Parcel): ParcelStatus {
  if (p.retired) return 'RETIRED';
  if (p.frozen) return 'FROZEN';
  if (p.openDisputeIds.length > 0) return 'DISPUTED';
  if (p.activeEncumbranceIds.length > 0) return 'ENCUMBERED';
  if (p.activeTransferId !== null) return 'PENDING_TRANSFER';
  return 'ACTIVE';
}

export const loadParcel = (ctx: Context, parcelId: string): Promise<Parcel> =>
  mustRead<Parcel>(ctx, KEYS.parcel(parcelId), `Parcel ${parcelId} is not registered on Milki.`);

export async function saveParcel(ctx: Context, actor: ActorRef, parcel: Parcel): Promise<Parcel> {
  parcel.status = deriveParcelStatus(parcel);
  stamp(ctx, actor, parcel);
  await writeState(ctx, KEYS.parcel(parcel.parcelId), parcel);
  return parcel;
}

export const loadTransfer = (ctx: Context, transferId: string): Promise<Transfer> =>
  mustRead<Transfer>(ctx, KEYS.transfer(transferId), `Transfer ${transferId} was not found.`);

export async function saveTransfer(ctx: Context, actor: ActorRef, transfer: Transfer): Promise<Transfer> {
  stamp(ctx, actor, transfer);
  await writeState(ctx, KEYS.transfer(transfer.transferId), transfer);
  return transfer;
}

const ENCUMBRANCE_WORD: Record<Encumbrance['type'], string> = {
  MORTGAGE: 'mortgage',
  CHARGE: 'charge',
  CAVEAT: 'caveat',
  LIEN: 'lien',
};

export function assertNotRetired(parcel: Parcel): void {
  if (parcel.retired) {
    throw new MilkiError('PARCEL_RETIRED', `Parcel ${parcel.parcelId} has been retired from the register.`, {
      parcelId: parcel.parcelId,
    });
  }
}

export function assertNotFrozen(parcel: Parcel): void {
  if (parcel.frozen) {
    const why = parcel.frozenReason ? ` Reason: ${parcel.frozenReason}` : '';
    throw new MilkiError('PARCEL_FROZEN', `Parcel ${parcel.parcelId} is frozen by the land registry.${why}`, {
      parcelId: parcel.parcelId,
    });
  }
}

export function assertNotDisputed(parcel: Parcel): void {
  if (parcel.openDisputeIds.length > 0) {
    throw new MilkiError(
      'PARCEL_DISPUTED',
      `Parcel ${parcel.parcelId} has an open dispute. It cannot change hands until the dispute is resolved.`,
      { parcelId: parcel.parcelId, disputeId: parcel.openDisputeIds[0] ?? null },
    );
  }
}

/** Human-readable: "This parcel has an active mortgage with CRDB Bank." */
export async function assertNotEncumbered(ctx: Context, parcel: Parcel): Promise<void> {
  const firstId = parcel.activeEncumbranceIds[0];
  if (firstId === undefined) return;
  const enc = await readState<Encumbrance>(ctx, KEYS.encumbrance(firstId));
  const what = enc ? `an active ${ENCUMBRANCE_WORD[enc.type]} with ${enc.lenderName}` : 'an active encumbrance';
  throw new MilkiError('PARCEL_ENCUMBERED', `This parcel has ${what}. It must be released before the parcel can be transferred.`, {
    parcelId: parcel.parcelId,
    encumbranceId: firstId,
  });
}

export function assertNoOtherTransfer(parcel: Parcel, ownTransferId: string | null): void {
  if (parcel.activeTransferId !== null && parcel.activeTransferId !== ownTransferId) {
    throw new MilkiError('TRANSFER_IN_PROGRESS', `Parcel ${parcel.parcelId} already has a transfer in progress.`, {
      parcelId: parcel.parcelId,
      transferId: parcel.activeTransferId,
    });
  }
}

/** The transfer guards (CLAUDE.md §7.1): no transfer step while RETIRED, FROZEN, DISPUTED, ENCUMBERED or busy. */
export async function assertTransferable(ctx: Context, parcel: Parcel, ownTransferId: string | null): Promise<void> {
  assertNotRetired(parcel);
  assertNotFrozen(parcel);
  assertNotDisputed(parcel);
  await assertNotEncumbered(ctx, parcel);
  assertNoOtherTransfer(parcel, ownTransferId);
}

export const without = (list: string[], id: string): string[] => list.filter((x) => x !== id);
