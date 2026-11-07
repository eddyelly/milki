import { type InferSchemaType, model, Schema } from 'mongoose';

/**
 * Read cache of on-chain parcels, written ONLY by the chaincode event listener (CLAUDE.md §7.2).
 * Used for lists, search and dashboards. Ownership checks and verification always go to the ledger (rule 3).
 */
const parcelCacheSchema = new Schema(
  {
    parcelId: { type: String, required: true, unique: true },
    titleNumber: { type: String, index: true },
    region: { type: String, index: true },
    district: { type: String, index: true },
    ward: String,
    blockNumber: String,
    plotNumber: String,
    area: Number,
    landUse: { type: String, index: true },
    location: { latitude: Number, longitude: Number, address: String },
    ownerId: { type: String, index: true },
    ownershipVersion: Number,
    status: { type: String, index: true },
    frozen: Boolean,
    retired: Boolean,
    activeTransferId: String,
    activeEncumbranceIds: [String],
    openDisputeIds: [String],
    ledgerCreatedAt: Date,
    ledgerUpdatedAt: { type: Date, index: true },
    lastTxId: String,
    lastBlock: Number,
  },
  { timestamps: { createdAt: false, updatedAt: 'syncedAt' }, collection: 'parcel_cache', versionKey: false },
);

parcelCacheSchema.index({ parcelId: 'text', titleNumber: 'text', region: 'text', district: 'text', ward: 'text' });

export type ParcelCacheAttrs = InferSchemaType<typeof parcelCacheSchema>;
export const ParcelCache = model('ParcelCache', parcelCacheSchema);
