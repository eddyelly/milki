import type { Context } from 'fabric-contract-api';
import { conflict, forbidden, invalid, invalidState, MilkiError } from '../errors';
import { getActor, getBankCode, requireRole } from '../identity';
import { emit, KEYS, mustRead, newId, readState, writeState, txTime } from '../ledger';
import { type ActorRef, ENCUMBRANCE_TYPES, type Encumbrance, type EncumbranceChange } from '../models';
import * as v from '../validation';
import { assertNotDisputed, assertNotFrozen, assertNotRetired, created, loadParcel, saveParcel, stamp, without } from './common';

const loadEncumbrance = (ctx: Context, id: string): Promise<Encumbrance> =>
  mustRead<Encumbrance>(ctx, KEYS.encumbrance(id), `Encumbrance ${id} was not found.`);

async function saveEncumbrance(ctx: Context, actor: ActorRef, enc: Encumbrance): Promise<Encumbrance> {
  stamp(ctx, actor, enc);
  await writeState(ctx, KEYS.encumbrance(enc.encumbranceId), enc);
  return enc;
}

function assertOwnBank(enc: Encumbrance, bankCode: string): void {
  if (enc.lenderCode !== bankCode) {
    throw forbidden(`This encumbrance belongs to ${enc.lenderName}. Only that bank can change or release it.`);
  }
}

function event(ctx: Context, actor: ActorRef, enc: Encumbrance, action: string): void {
  emit(ctx, {
    entity: 'Encumbrance',
    action,
    id: enc.encumbranceId,
    parcelId: enc.parcelId,
    status: enc.status,
    actor,
    data: { lenderCode: enc.lenderCode, lenderName: enc.lenderName, type: enc.type },
  });
}

export async function addEncumbrance(ctx: Context, parcelIdArg: string, raw: string): Promise<Encumbrance> {
  const actor = getActor(ctx);
  requireRole(actor, ['BANK_OFFICER'], 'register a mortgage or other encumbrance');
  const lenderCode = getBankCode(ctx);
  const parcel = await loadParcel(ctx, v.parcelId(parcelIdArg));

  const input = v.parseObject(raw, 'encumbrance');
  v.onlyKeys(input, ['type', 'lenderName', 'amount', 'currency', 'reference', 'termsHash'], 'encumbrance');
  const type = v.oneOf(input.type, ENCUMBRANCE_TYPES, 'type');
  const lenderName = v.str(input.lenderName, 'lenderName', { max: 100 });
  const amount = v.num(input.amount, 'amount', { positive: true });
  const currency = v.str(input.currency, 'currency', { pattern: v.CURRENCY_RE, patternHint: 'ISO code, e.g. TZS', max: 3 });
  const reference = v.str(input.reference, 'reference', { max: 80 });
  const termsHash = input.termsHash === undefined || input.termsHash === null ? null : v.sha256(input.termsHash, 'termsHash');

  assertNotRetired(parcel);
  assertNotFrozen(parcel);
  assertNotDisputed(parcel);
  if (parcel.activeTransferId) {
    throw new MilkiError('TRANSFER_IN_PROGRESS', `Parcel ${parcel.parcelId} has a transfer in progress and cannot be encumbered right now.`, {
      transferId: parcel.activeTransferId,
    });
  }

  const encumbranceId = newId(ctx, 'ENC');
  if (await readState(ctx, KEYS.encumbrance(encumbranceId))) throw conflict(`Encumbrance ${encumbranceId} already exists.`);
  const enc: Encumbrance = {
    docType: 'encumbrance',
    encumbranceId,
    parcelId: parcel.parcelId,
    type,
    lenderCode,
    lenderName,
    amount,
    currency,
    reference,
    termsHash,
    status: 'ACTIVE',
    releaseReason: null,
    releasedAt: null,
    releasedBy: null,
    changes: [],
    ...created(ctx, actor),
  };
  parcel.activeEncumbranceIds.push(encumbranceId);
  parcel.encumbranceIds.push(encumbranceId);
  await saveParcel(ctx, actor, parcel);
  await saveEncumbrance(ctx, actor, enc);
  event(ctx, actor, enc, 'Added');
  return enc;
}

export async function updateEncumbrance(ctx: Context, encumbranceIdArg: string, raw: string): Promise<Encumbrance> {
  const actor = getActor(ctx);
  requireRole(actor, ['BANK_OFFICER'], 'update encumbrances');
  const bankCode = getBankCode(ctx);
  const enc = await loadEncumbrance(ctx, v.entityId(encumbranceIdArg, 'encumbranceId'));
  assertOwnBank(enc, bankCode);
  if (enc.status !== 'ACTIVE') throw invalidState('This encumbrance has been released and can no longer be changed.');

  const input = v.parseObject(raw, 'update');
  v.onlyKeys(input, ['amount', 'currency', 'reference', 'termsHash'], 'update');
  const changes: EncumbranceChange['changes'] = [];
  if (input.amount !== undefined) {
    const amount = v.num(input.amount, 'amount', { positive: true });
    if (amount !== enc.amount) changes.push({ field: 'amount', from: enc.amount, to: amount });
    enc.amount = amount;
  }
  if (input.currency !== undefined) {
    const currency = v.str(input.currency, 'currency', { pattern: v.CURRENCY_RE, max: 3 });
    if (currency !== enc.currency) changes.push({ field: 'currency', from: enc.currency, to: currency });
    enc.currency = currency;
  }
  if (input.reference !== undefined) {
    const reference = v.str(input.reference, 'reference', { max: 80 });
    if (reference !== enc.reference) changes.push({ field: 'reference', from: enc.reference, to: reference });
    enc.reference = reference;
  }
  if (input.termsHash !== undefined) {
    const termsHash = input.termsHash === null ? null : v.sha256(input.termsHash, 'termsHash');
    if (termsHash !== enc.termsHash) changes.push({ field: 'termsHash', from: enc.termsHash, to: termsHash });
    enc.termsHash = termsHash;
  }
  if (changes.length === 0) throw invalid('Nothing changed. Provide a new amount, currency, reference or termsHash.');

  enc.changes.push({ at: txTime(ctx), by: actor, txId: ctx.stub.getTxID(), changes });
  await saveEncumbrance(ctx, actor, enc);
  event(ctx, actor, enc, 'Updated');
  return enc;
}

/** "Delete" for encumbrances (rule 8): status becomes RELEASED, history is kept. */
export async function releaseEncumbrance(ctx: Context, encumbranceIdArg: string, reasonArg: string): Promise<Encumbrance> {
  const actor = getActor(ctx);
  requireRole(actor, ['BANK_OFFICER'], 'release encumbrances');
  const bankCode = getBankCode(ctx);
  const enc = await loadEncumbrance(ctx, v.entityId(encumbranceIdArg, 'encumbranceId'));
  assertOwnBank(enc, bankCode);
  const why = v.reason(reasonArg);
  if (enc.status !== 'ACTIVE') throw invalidState('This encumbrance has already been released.');

  enc.status = 'RELEASED';
  enc.releaseReason = why;
  enc.releasedAt = txTime(ctx);
  enc.releasedBy = actor;
  const parcel = await loadParcel(ctx, enc.parcelId);
  parcel.activeEncumbranceIds = without(parcel.activeEncumbranceIds, enc.encumbranceId);
  await saveParcel(ctx, actor, parcel);
  await saveEncumbrance(ctx, actor, enc);
  event(ctx, actor, enc, 'Released');
  return enc;
}

export async function getEncumbrances(ctx: Context, parcelIdArg: string): Promise<Encumbrance[]> {
  const parcel = await loadParcel(ctx, v.parcelId(parcelIdArg));
  const out: Encumbrance[] = [];
  for (const id of parcel.encumbranceIds) {
    const enc = await readState<Encumbrance>(ctx, KEYS.encumbrance(id));
    if (enc) out.push(enc);
  }
  return out;
}

export async function getEncumbrance(ctx: Context, encumbranceIdArg: string): Promise<Encumbrance> {
  return loadEncumbrance(ctx, v.entityId(encumbranceIdArg, 'encumbranceId'));
}
