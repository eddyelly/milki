import { model, Schema } from 'mongoose';

// Transaction tracking, lets clients poll GET /ledger/tx/:txId if they missed the socket event.
const ledgerTxSchema = new Schema(
  {
    txId: { type: String, required: true, unique: true },
    userId: { type: String, required: true, index: true },
    fn: { type: String, required: true },
    entityType: String,
    entityId: String,
    status: { type: String, enum: ['SUBMITTED', 'COMMITTED', 'FAILED'], default: 'SUBMITTED' },
    blockNumber: Number,
    validationCode: String,
    submittedAt: { type: Date, default: () => new Date() },
    committedAt: Date,
  },
  { versionKey: false, collection: 'ledger_transactions' },
);
export const LedgerTx = model('LedgerTx', ledgerTxSchema);

