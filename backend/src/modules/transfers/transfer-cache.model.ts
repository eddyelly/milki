import { type InferSchemaType, model, Schema } from 'mongoose';
import { TRANSFER_STATUSES } from './transfer.types';

/** Read cache of on-chain transfers, written only by the event listener. Never holds the sale price. */
const transferCacheSchema = new Schema(
  {
    transferId: { type: String, required: true, unique: true },
    parcelId: { type: String, required: true, index: true },
    sellerId: { type: String, required: true, index: true },
    buyerId: { type: String, required: true, index: true },
    status: { type: String, enum: TRANSFER_STATUSES, index: true },
    verifiedBy: String,
    approvedBy: String,
    closedReason: String,
    steps: [{ status: String, at: Date, byRole: String, txId: String }],
    ledgerCreatedAt: { type: Date, index: true },
    ledgerUpdatedAt: { type: Date, index: true },
    lastTxId: String,
    lastBlock: Number,
  },
  { timestamps: { createdAt: false, updatedAt: 'syncedAt' }, collection: 'transfer_cache', versionKey: false },
);

export type TransferCacheAttrs = InferSchemaType<typeof transferCacheSchema>;
export const TransferCache = model('TransferCache', transferCacheSchema);
