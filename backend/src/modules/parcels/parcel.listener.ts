import { onLedgerEvent } from '../../core/fabric/events';
import { ledger } from '../../core/fabric/ledger';
import { logger } from '../../core/logger';
import { ParcelCache } from './parcel-cache.model';
import type { LedgerParcel } from './parcel.types';

/** Upserts the cache entry for a parcel from the ledger's current state (no PII is cached). */
export async function syncParcel(parcelId: string, blockNumber: number): Promise<void> {
  const p = await ledger.evaluate<LedgerParcel>('service', 'GetParcel', [parcelId]);
  await ParcelCache.updateOne(
    { parcelId },
    {
      parcelId: p.parcelId,
      titleNumber: p.titleNumber,
      region: p.region,
      district: p.district,
      ward: p.ward,
      blockNumber: p.blockNumber,
      plotNumber: p.plotNumber,
      area: p.area,
      landUse: p.landUse,
      location: { latitude: p.location.latitude, longitude: p.location.longitude, address: p.location.address ?? undefined },
      ownerId: p.ownerId,
      ownershipVersion: p.ownershipVersion,
      status: p.status,
      frozen: p.frozen,
      retired: p.retired,
      activeTransferId: p.activeTransferId,
      activeEncumbranceIds: p.activeEncumbranceIds,
      openDisputeIds: p.openDisputeIds,
      ledgerCreatedAt: new Date(p.createdAt),
      ledgerUpdatedAt: new Date(p.updatedAt),
      lastTxId: p.lastTxId,
      lastBlock: blockNumber,
    },
    { upsert: true },
  );
}

/** Every Milki event concerns one parcel; refreshing it keeps status/owner in the cache current. */
export function registerParcelListener(): void {
  onLedgerEvent(async (event, ctx) => {
    if (!event.parcelId) return;
    await syncParcel(event.parcelId, ctx.blockNumber);
    logger.debug({ parcelId: event.parcelId, event: ctx.name }, 'parcel cache updated');
  });
}
