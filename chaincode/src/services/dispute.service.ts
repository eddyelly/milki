import type { Context } from 'fabric-contract-api';
import { conflict, invalidState } from '../errors';
import { getActor, requireRole } from '../identity';
import { emit, KEYS, mustRead, newId, readState, txTime, writeState } from '../ledger';
import { type ActorRef, DISPUTE_CATEGORIES, type Dispute } from '../models';
import * as v from '../validation';
import { assertNotRetired, created, loadParcel, saveParcel, stamp, without } from './common';

const loadDispute = (ctx: Context, id: string): Promise<Dispute> =>
  mustRead<Dispute>(ctx, KEYS.dispute(id), `Dispute ${id} was not found.`);

async function saveDispute(ctx: Context, actor: ActorRef, d: Dispute): Promise<Dispute> {
  stamp(ctx, actor, d);
  await writeState(ctx, KEYS.dispute(d.disputeId), d);
  return d;
}

function event(ctx: Context, actor: ActorRef, d: Dispute, action: string): void {
  emit(ctx, { entity: 'Dispute', action, id: d.disputeId, parcelId: d.parcelId, status: d.status, actor, data: { category: d.category } });
}

/**
 * Flags a dispute on a parcel; while any dispute is open the parcel is DISPUTED and cannot change hands.
 * `summary` is shown to officials, it must describe the issue without personal data (names/NIDA go off-chain).
 */
export async function flagDispute(ctx: Context, parcelIdArg: string, raw: string): Promise<Dispute> {
  const actor = getActor(ctx);
  requireRole(actor, ['LAND_OFFICER'], 'flag disputes');
  const parcel = await loadParcel(ctx, v.parcelId(parcelIdArg));
  const input = v.parseObject(raw, 'dispute');
  v.onlyKeys(input, ['category', 'summary'], 'dispute');
  const category = v.oneOf(input.category, DISPUTE_CATEGORIES, 'category');
  const summary = v.str(input.summary, 'summary', { min: 10, max: 500 });
  assertNotRetired(parcel);

  const disputeId = newId(ctx, 'DSP');
  if (await readState(ctx, KEYS.dispute(disputeId))) throw conflict(`Dispute ${disputeId} already exists.`);
  const dispute: Dispute = {
    docType: 'dispute',
    disputeId,
    parcelId: parcel.parcelId,
    category,
    summary,
    status: 'OPEN',
    notes: [],
    resolution: null,
    resolvedAt: null,
    resolvedBy: null,
    ...created(ctx, actor),
  };
  parcel.openDisputeIds.push(disputeId);
  parcel.disputeIds.push(disputeId);
  await saveParcel(ctx, actor, parcel);
  await saveDispute(ctx, actor, dispute);
  event(ctx, actor, dispute, 'Flagged');
  return dispute;
}

export async function addDisputeNote(ctx: Context, disputeIdArg: string, textArg: string): Promise<Dispute> {
  const actor = getActor(ctx);
  requireRole(actor, ['LAND_OFFICER', 'REGISTRAR'], 'add dispute notes');
  const d = await loadDispute(ctx, v.entityId(disputeIdArg, 'disputeId'));
  const text = v.str(textArg, 'note', { min: 3, max: 1000 });
  if (d.status !== 'OPEN') throw invalidState('This dispute is resolved. Notes can only be added to open disputes.');
  d.notes.push({ at: txTime(ctx), by: actor, txId: ctx.stub.getTxID(), text });
  await saveDispute(ctx, actor, d);
  event(ctx, actor, d, 'NoteAdded');
  return d;
}

export async function resolveDispute(ctx: Context, disputeIdArg: string, resolutionArg: string): Promise<Dispute> {
  const actor = getActor(ctx);
  requireRole(actor, ['LAND_OFFICER', 'REGISTRAR'], 'resolve disputes');
  const d = await loadDispute(ctx, v.entityId(disputeIdArg, 'disputeId'));
  const resolution = v.str(resolutionArg, 'resolution', { min: 3, max: 1000 });
  if (d.status !== 'OPEN') throw invalidState('This dispute has already been resolved.');
  d.status = 'RESOLVED';
  d.resolution = resolution;
  d.resolvedAt = txTime(ctx);
  d.resolvedBy = actor;
  const parcel = await loadParcel(ctx, d.parcelId);
  parcel.openDisputeIds = without(parcel.openDisputeIds, d.disputeId);
  await saveParcel(ctx, actor, parcel);
  await saveDispute(ctx, actor, d);
  event(ctx, actor, d, 'Resolved');
  return d;
}

export async function getDisputes(ctx: Context, parcelIdArg: string): Promise<Dispute[]> {
  const parcel = await loadParcel(ctx, v.parcelId(parcelIdArg));
  const out: Dispute[] = [];
  for (const id of parcel.disputeIds) {
    const d = await readState<Dispute>(ctx, KEYS.dispute(id));
    if (d) out.push(d);
  }
  return out;
}
