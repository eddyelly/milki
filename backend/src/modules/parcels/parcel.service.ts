import type { QueryFilter } from 'mongoose';
import type { AuthUser } from '../../core/auth';
import { piiHash } from '../../core/crypto';
import { badRequest, forbidden, notFound } from '../../core/errors';
import { ledger, type SubmitResult } from '../../core/fabric/ledger';
import { User } from '../users/user.model';
import { toWalletUser as walletUser } from '../users/user.service';
import { ParcelCache, type ParcelCacheAttrs } from './parcel-cache.model';
import type { ListQuery, RegisterParcelBody, UpdateParcelBody } from './parcel.schema';
import type { LedgerHistoryEntry, LedgerParcel } from './parcel.types';

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ------------------------------------------------------------------------------------------- reads
/** Paginated list from the Mongo cache. Citizens only ever see their own parcels. */
export async function list(user: AuthUser, q: ListQuery): Promise<{ items: ParcelCacheAttrs[]; total: number }> {
  const filter: QueryFilter<ParcelCacheAttrs> = {};
  if (user.role === 'CITIZEN') filter.ownerId = user.userId;
  else if (q.ownerId) filter.ownerId = q.ownerId;
  if (q.status?.length) filter.status = { $in: q.status };
  if (q.region) filter.region = new RegExp(`^${escapeRegex(q.region)}$`, 'i');
  if (q.district) filter.district = new RegExp(`^${escapeRegex(q.district)}$`, 'i');
  if (q.landUse) filter.landUse = q.landUse;
  if (q.q) {
    const rx = new RegExp(escapeRegex(q.q), 'i');
    filter.$or = [{ parcelId: rx }, { titleNumber: rx }, { region: rx }, { district: rx }, { ward: rx }];
  }
  const sortField = q.sort.replace('-', '');
  const sortKey = sortField === 'updatedAt' ? 'ledgerUpdatedAt' : sortField === 'createdAt' ? 'ledgerCreatedAt' : sortField;
  const [items, total] = await Promise.all([
    ParcelCache.find(filter)
      .sort({ [sortKey]: q.sort.startsWith('-') ? -1 : 1, parcelId: 1 })
      .skip((q.page - 1) * q.limit)
      .limit(q.limit)
      .lean(),
    ParcelCache.countDocuments(filter),
  ]);
  return { items: items as ParcelCacheAttrs[], total };
}

function assertCanView(user: AuthUser, parcel: LedgerParcel): void {
  if (user.role === 'CITIZEN' && parcel.ownerId !== user.userId) {
    throw forbidden('You can only view parcels registered to you. Use Verify to check another parcel.');
  }
}

/** Officials see who the owner is; the owner's NIDA hash never leaves the backend. */
async function present(user: AuthUser, parcel: LedgerParcel) {
  const { ownerNidaHash: _hidden, ...rest } = parcel;
  if (user.role === 'CITIZEN') return { ...rest, owner: { userId: parcel.ownerId } };
  const owner = await User.findOne({ userId: parcel.ownerId }, { userId: 1, fullName: 1, phone: 1 }).lean();
  return { ...rest, owner: owner ? { userId: owner.userId, fullName: owner.fullName, phone: owner.phone } : { userId: parcel.ownerId } };
}

/** Straight from the ledger (rule 3). */
export async function get(user: AuthUser, parcelId: string) {
  const parcel = await ledger.evaluate<LedgerParcel>(await walletUser(user), 'GetParcel', [parcelId]);
  assertCanView(user, parcel);
  return present(user, parcel);
}

/** The ownership chain: every committed version of the parcel, oldest first. */
export async function history(user: AuthUser, parcelId: string) {
  const wu = await walletUser(user);
  const current = await ledger.evaluate<LedgerParcel>(wu, 'GetParcel', [parcelId]);
  assertCanView(user, current);
  const entries = await ledger.evaluate<LedgerHistoryEntry[]>(wu, 'GetParcelHistory', [parcelId]);
  // Officials see owner names on the chain; citizens see only opaque IDs.
  const names = new Map<string, string>();
  if (user.role !== 'CITIZEN') {
    const ids = [...new Set(entries.map((e) => e.parcel?.ownerId).filter((x): x is string => Boolean(x)))];
    for (const u of await User.find({ userId: { $in: ids } }, { userId: 1, fullName: 1 }).lean()) names.set(u.userId, u.fullName);
  }
  return entries.map((e) => ({
    ownerName: e.parcel?.ownerId ? (names.get(e.parcel.ownerId) ?? null) : null,
    txId: e.txId,
    timestamp: e.timestamp,
    status: e.parcel?.status ?? null,
    ownerId: e.parcel?.ownerId ?? null,
    ownershipVersion: e.parcel?.ownershipVersion ?? null,
    changedBy: e.parcel?.updatedBy ?? null,
    note: e.parcel?.lastChangeNote ?? null,
  }));
}

/** Related on-chain records: encumbrances, disputes, transfers or documents of a parcel. */
export async function related(user: AuthUser, parcelId: string, kind: 'encumbrances' | 'disputes' | 'transfers' | 'documents') {
  const wu = await walletUser(user);
  const parcel = await ledger.evaluate<LedgerParcel>(wu, 'GetParcel', [parcelId]);
  assertCanView(user, parcel);
  const call: Record<typeof kind, [string, string[]]> = {
    encumbrances: ['GetEncumbrances', [parcelId]],
    disputes: ['GetDisputes', [parcelId]],
    transfers: ['GetParcelTransfers', [parcelId]],
    documents: ['GetDocuments', ['PARCEL', parcelId]],
  };
  const [fn, args] = call[kind];
  return ledger.evaluate<unknown[]>(wu, fn, args);
}

// ------------------------------------------------------------------------------------------ writes
async function resolveOwner(owner: RegisterParcelBody['owner']): Promise<{ userId: string; nidaHash: string }> {
  const query = 'userId' in owner ? { userId: owner.userId } : { nidaHash: piiHash(owner.nida) };
  const user = await User.findOne({ ...query, deletedAt: null }).lean();
  if (!user || user.role !== 'CITIZEN') {
    throw notFound('No registered landowner matches that ID or NIDA number. Ask the owner to register on Milki first.', 'OWNER_NOT_FOUND');
  }
  if (user.status !== 'ACTIVE') throw badRequest('The owner has not finished verifying their Milki account.', undefined, 'OWNER_NOT_ACTIVE');
  if (!user.nidaHash) throw badRequest('The owner has no NIDA number on file.', undefined, 'OWNER_NIDA_MISSING');
  return { userId: user.userId, nidaHash: user.nidaHash };
}

export async function register(user: AuthUser, body: RegisterParcelBody): Promise<SubmitResult<LedgerParcel> & { ownerId: string }> {
  const owner = await resolveOwner(body.owner);
  const { owner: _ref, location, ...rest } = body;
  const payload = {
    ...rest,
    location: { latitude: location.latitude, longitude: location.longitude, boundary: location.boundary ?? null, address: location.address ?? null },
    ownerId: owner.userId,
    ownerNidaHash: owner.nidaHash,
  };
  const res = await ledger.submit<LedgerParcel>(await walletUser(user), 'RegisterParcel', [JSON.stringify(payload)], {
    entityType: 'Parcel',
    entityId: body.parcelId,
  });
  return { ...res, ownerId: owner.userId };
}

export async function update(user: AuthUser, parcelId: string, body: UpdateParcelBody) {
  return ledger.submit<LedgerParcel>(await walletUser(user), 'UpdateParcel', [parcelId, JSON.stringify(body)], { entityType: 'Parcel', entityId: parcelId });
}

export async function changeState(user: AuthUser, parcelId: string, action: 'FreezeParcel' | 'UnfreezeParcel' | 'RetireParcel', reason: string) {
  return ledger.submit<LedgerParcel>(await walletUser(user), action, [parcelId, reason], { entityType: 'Parcel', entityId: parcelId });
}
