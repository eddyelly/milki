import type { Context } from 'fabric-contract-api';
import { conflict, invalid, invalidState, MilkiError } from '../errors';
import { getActor, requireRole } from '../identity';
import { drain, emit, KEYS, type Page, queryPage, readState, timestampToIso, writeState, fromBytes } from '../ledger';
import { LAND_USES, type Parcel, type ParcelLocation, type Transfer } from '../models';
import * as v from '../validation';
import { assertNotRetired, created, loadParcel, saveParcel } from './common';

const REGISTER_FIELDS = [
  'parcelId',
  'titleNumber',
  'region',
  'district',
  'ward',
  'blockNumber',
  'plotNumber',
  'area',
  'landUse',
  'location',
  'ownerId',
  'ownerNidaHash',
] as const;

/** UpdateParcel may only touch these (CLAUDE.md §7.1). */
const UPDATE_FIELDS = ['landUse', 'area', 'areaCorrectionReason', 'location'] as const;

const MAX_AREA_SQM = 1_000_000_000;

export function parseLocation(value: unknown): ParcelLocation {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw invalid('location is required.');
  const loc = value as v.JsonObject;
  v.onlyKeys(loc, ['latitude', 'longitude', 'boundary', 'address'], 'location');
  const latitude = v.num(loc.latitude, 'location.latitude', { min: -90, max: 90 });
  const longitude = v.num(loc.longitude, 'location.longitude', { min: -180, max: 180 });
  let boundary: [number, number][] | null = null;
  if (loc.boundary !== undefined && loc.boundary !== null) {
    if (!Array.isArray(loc.boundary) || loc.boundary.length < 3 || loc.boundary.length > 500) {
      throw invalid('location.boundary must list between 3 and 500 points.');
    }
    boundary = loc.boundary.map((pt: unknown, i: number) => {
      if (!Array.isArray(pt) || pt.length !== 2) throw invalid(`location.boundary[${i}] must be [longitude, latitude].`);
      return [
        v.num(pt[0], `location.boundary[${i}][0]`, { min: -180, max: 180 }),
        v.num(pt[1], `location.boundary[${i}][1]`, { min: -90, max: 90 }),
      ];
    });
  }
  const address = v.optStr(loc.address, 'location.address', { max: 200 });
  return { latitude, longitude, boundary, address };
}

export async function registerParcel(ctx: Context, raw: string): Promise<Parcel> {
  const actor = getActor(ctx);
  requireRole(actor, ['REGISTRAR'], 'register parcels');

  const input = v.parseObject(raw, 'parcel');
  v.onlyKeys(input, REGISTER_FIELDS, 'parcel');
  const parcelId = v.parcelId(input.parcelId);
  const titleNumber = v.str(input.titleNumber, 'titleNumber', { max: 40, pattern: /^[A-Za-z0-9/-]+$/, patternHint: 'letters, digits, / and -' });
  const parcel: Parcel = {
    docType: 'parcel',
    parcelId,
    titleNumber,
    region: v.str(input.region, 'region', { max: 80 }),
    district: v.str(input.district, 'district', { max: 80 }),
    ward: v.str(input.ward, 'ward', { max: 80 }),
    blockNumber: v.str(input.blockNumber, 'blockNumber', { max: 20 }),
    plotNumber: v.str(input.plotNumber, 'plotNumber', { max: 20 }),
    area: v.num(input.area, 'area', { positive: true, max: MAX_AREA_SQM }),
    landUse: v.oneOf(input.landUse, LAND_USES, 'landUse'),
    location: parseLocation(input.location),
    ownerId: v.userId(input.ownerId, 'ownerId'),
    ownerNidaHash: v.sha256(input.ownerNidaHash, 'ownerNidaHash'),
    ownershipVersion: 1,
    status: 'ACTIVE',
    frozen: false,
    frozenReason: null,
    retired: false,
    retiredReason: null,
    lastChangeNote: null,
    activeTransferId: null,
    transferIds: [],
    activeEncumbranceIds: [],
    encumbranceIds: [],
    openDisputeIds: [],
    disputeIds: [],
    documentIds: [],
    ...created(ctx, actor),
  };

  if (await readState(ctx, KEYS.parcel(parcelId))) {
    throw conflict(`Parcel ${parcelId} is already registered.`, { parcelId });
  }
  const titleOwner = await readState<{ parcelId: string }>(ctx, KEYS.title(titleNumber));
  if (titleOwner) {
    throw conflict(`Title number ${titleNumber} is already registered to parcel ${titleOwner.parcelId}.`, {
      titleNumber,
      parcelId: titleOwner.parcelId,
    });
  }

  await saveParcel(ctx, actor, parcel);
  await writeState(ctx, KEYS.title(titleNumber), { docType: 'titleIndex', titleNumber, parcelId });
  emit(ctx, { entity: 'Parcel', action: 'Registered', id: parcelId, parcelId, status: parcel.status, actor, data: { ownerId: parcel.ownerId } });
  return parcel;
}

export async function getParcel(ctx: Context, parcelId: string): Promise<Parcel> {
  return loadParcel(ctx, v.parcelId(parcelId));
}

export interface ParcelHistoryEntry {
  txId: string;
  timestamp: string;
  isDelete: boolean;
  parcel: Parcel | null;
}

/** Every committed version of the parcel, oldest first, the ownership chain. */
export async function getParcelHistory(ctx: Context, parcelIdArg: string): Promise<ParcelHistoryEntry[]> {
  const parcelId = v.parcelId(parcelIdArg);
  await loadParcel(ctx, parcelId);
  const rows = await drain(await ctx.stub.getHistoryForKey(KEYS.parcel(parcelId)));
  const entries = rows.map((r) => ({
    txId: r.txId,
    timestamp: timestampToIso(r.timestamp),
    isDelete: r.isDelete,
    parcel: r.isDelete || r.value.length === 0 ? null : fromBytes<Parcel>(r.value),
  }));
  // Peers may return history newest-first; present it chronologically (stable sort keeps block order on ties).
  return entries.sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0));
}

interface ListQuery {
  selector: Record<string, unknown>;
  sort: Record<string, 'asc' | 'desc'>[] | undefined;
}

/** Parses `{ selector?, sort? }`. docType is always forced by the caller, so a query can never escape its entity. */
export function parseListQuery(raw: string): ListQuery {
  const input = v.parseObject(raw || '{}', 'query');
  v.onlyKeys(input, ['selector', 'sort'], 'query');
  const selector = input.selector ?? {};
  if (selector === null || typeof selector !== 'object' || Array.isArray(selector)) throw invalid('query.selector must be an object.');
  let sort: ListQuery['sort'];
  if (input.sort !== undefined) {
    if (!Array.isArray(input.sort)) throw invalid('query.sort must be an array like [{"updatedAt":"desc"}].');
    sort = input.sort.map((entry: unknown) => {
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry) || Object.keys(entry).length !== 1) {
        throw invalid('Each query.sort entry must have exactly one field.');
      }
      const [field, dir] = Object.entries(entry)[0] as [string, unknown];
      if (dir !== 'asc' && dir !== 'desc') throw invalid('Sort direction must be "asc" or "desc".');
      return { [field]: dir };
    });
  }
  return { selector: selector as Record<string, unknown>, sort };
}

export async function queryParcels(ctx: Context, rawQuery: string, size: string, bookmark: string): Promise<Page<Parcel>> {
  const q = parseListQuery(rawQuery);
  return queryPage<Parcel>(ctx, 'parcel', q.selector, q.sort, v.pageSize(size), bookmark ?? '');
}

export async function updateParcel(ctx: Context, parcelIdArg: string, rawPatch: string): Promise<Parcel> {
  const actor = getActor(ctx);
  requireRole(actor, ['REGISTRAR'], 'update parcel details');
  const parcel = await loadParcel(ctx, v.parcelId(parcelIdArg));
  assertNotRetired(parcel);

  const patch = v.parseObject(rawPatch, 'update');
  v.onlyKeys(patch, UPDATE_FIELDS, 'update');
  const changed: string[] = [];
  if (patch.landUse !== undefined) {
    parcel.landUse = v.oneOf(patch.landUse, LAND_USES, 'landUse');
    changed.push('landUse');
  }
  if (patch.area !== undefined) {
    const area = v.num(patch.area, 'area', { positive: true, max: MAX_AREA_SQM });
    parcel.lastChangeNote = v.reason(patch.areaCorrectionReason, 'areaCorrectionReason');
    parcel.area = area;
    changed.push('area');
  } else if (patch.areaCorrectionReason !== undefined) {
    throw invalid('areaCorrectionReason is only accepted together with a new area.');
  }
  if (patch.location !== undefined) {
    parcel.location = parseLocation(patch.location);
    changed.push('location');
  }
  if (changed.length === 0) throw invalid('Nothing to update. Provide landUse, area or location.');

  await saveParcel(ctx, actor, parcel);
  emit(ctx, {
    entity: 'Parcel',
    action: 'Updated',
    id: parcel.parcelId,
    parcelId: parcel.parcelId,
    status: parcel.status,
    actor,
    data: { fields: changed.join(',') },
  });
  return parcel;
}

export async function freezeParcel(ctx: Context, parcelIdArg: string, reasonArg: string): Promise<Parcel> {
  const actor = getActor(ctx);
  requireRole(actor, ['REGISTRAR'], 'freeze parcels');
  const parcel = await loadParcel(ctx, v.parcelId(parcelIdArg));
  const why = v.reason(reasonArg);
  assertNotRetired(parcel);
  if (parcel.frozen) throw invalidState(`Parcel ${parcel.parcelId} is already frozen.`);
  parcel.frozen = true;
  parcel.frozenReason = why;
  parcel.lastChangeNote = why;
  await saveParcel(ctx, actor, parcel);
  emit(ctx, { entity: 'Parcel', action: 'Frozen', id: parcel.parcelId, parcelId: parcel.parcelId, status: parcel.status, actor });
  return parcel;
}

export async function unfreezeParcel(ctx: Context, parcelIdArg: string, reasonArg: string): Promise<Parcel> {
  const actor = getActor(ctx);
  requireRole(actor, ['REGISTRAR'], 'unfreeze parcels');
  const parcel = await loadParcel(ctx, v.parcelId(parcelIdArg));
  const why = v.reason(reasonArg);
  assertNotRetired(parcel);
  if (!parcel.frozen) throw invalidState(`Parcel ${parcel.parcelId} is not frozen.`);
  parcel.frozen = false;
  parcel.frozenReason = null;
  parcel.lastChangeNote = why;
  await saveParcel(ctx, actor, parcel);
  emit(ctx, { entity: 'Parcel', action: 'Unfrozen', id: parcel.parcelId, parcelId: parcel.parcelId, status: parcel.status, actor });
  return parcel;
}

/** "Delete" for parcels (rule 8): the record stays, status becomes RETIRED for good. */
export async function retireParcel(ctx: Context, parcelIdArg: string, reasonArg: string): Promise<Parcel> {
  const actor = getActor(ctx);
  requireRole(actor, ['REGISTRAR'], 'retire parcels');
  const parcel = await loadParcel(ctx, v.parcelId(parcelIdArg));
  const why = v.reason(reasonArg);
  if (parcel.retired) throw invalidState(`Parcel ${parcel.parcelId} is already retired.`);
  if (parcel.activeTransferId) {
    throw new MilkiError('TRANSFER_IN_PROGRESS', `Parcel ${parcel.parcelId} cannot be retired while a transfer is in progress.`, {
      transferId: parcel.activeTransferId,
    });
  }
  if (parcel.activeEncumbranceIds.length > 0) {
    throw new MilkiError('PARCEL_ENCUMBERED', `Parcel ${parcel.parcelId} cannot be retired while it has an active encumbrance.`);
  }
  if (parcel.openDisputeIds.length > 0) {
    throw new MilkiError('PARCEL_DISPUTED', `Parcel ${parcel.parcelId} cannot be retired while it has an open dispute.`);
  }
  parcel.retired = true;
  parcel.retiredReason = why;
  parcel.lastChangeNote = why;
  await saveParcel(ctx, actor, parcel);
  emit(ctx, { entity: 'Parcel', action: 'Retired', id: parcel.parcelId, parcelId: parcel.parcelId, status: parcel.status, actor });
  return parcel;
}

/** Loads the transfers listed on a parcel (oldest first). */
export async function getParcelTransfers(ctx: Context, parcelIdArg: string): Promise<Transfer[]> {
  const parcel = await loadParcel(ctx, v.parcelId(parcelIdArg));
  const out: Transfer[] = [];
  for (const id of parcel.transferIds) {
    const t = await readState<Transfer>(ctx, KEYS.transfer(id));
    if (t) out.push(t);
  }
  return out;
}
