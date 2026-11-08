import { type InferSchemaType, model, Schema } from 'mongoose';

/** CLAUDE.md §11. Off-chain only — agents never touch ledger data. */
export const TICKET_STATUSES = ['OPEN', 'IN_PROGRESS', 'AWAITING_USER', 'RESOLVED', 'CLOSED'] as const;
export const TICKET_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;
export const TICKET_CATEGORIES = ['GETTING_STARTED', 'TRANSFERS', 'DOCUMENTS', 'MORTGAGES', 'ACCOUNT', 'OTHER'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

const attachmentSchema = new Schema(
  {
    key: { type: String, required: true },
    name: { type: String, required: true },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true },
    sha256: { type: String, required: true },
  },
  { _id: false },
);

const ticketSchema = new Schema(
  {
    /** MLK-000123 */
    number: { type: String, required: true, unique: true },
    userId: { type: String, required: true, index: true },
    category: { type: String, enum: TICKET_CATEGORIES, required: true, index: true },
    priority: { type: String, enum: TICKET_PRIORITIES, default: 'NORMAL', index: true },
    subject: { type: String, required: true, trim: true },
    description: { type: String, required: true },
    status: { type: String, enum: TICKET_STATUSES, default: 'OPEN', index: true },
    assigneeId: { type: String, default: null, index: true },
    tags: { type: [String], default: [] },
    /** Context from a "Get help" button (parcel / transfer screens). */
    parcelId: { type: String, default: null },
    transferId: { type: String, default: null },
    attachments: { type: [attachmentSchema], default: [] },
    firstResponseDueAt: { type: Date, required: true },
    resolveDueAt: { type: Date, required: true },
    firstResponseAt: { type: Date, default: null },
    resolvedAt: { type: Date, default: null },
    closedAt: { type: Date, default: null },
    lastMessageAt: { type: Date, default: () => new Date() },
    rating: {
      type: new Schema({ stars: { type: Number, min: 1, max: 5, required: true }, comment: { type: String, default: '' }, at: { type: Date, required: true } }, { _id: false }),
      default: null,
    },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'tickets', versionKey: false },
);
ticketSchema.index({ status: 1, priority: -1, createdAt: 1 });
ticketSchema.index({ subject: 'text', description: 'text', number: 'text' });

export type TicketAttrs = InferSchemaType<typeof ticketSchema>;
export const Ticket = model('Ticket', ticketSchema);

const messageSchema = new Schema(
  {
    ticketId: { type: Schema.Types.ObjectId, required: true, index: true },
    authorId: { type: String, required: true },
    authorRole: { type: String, required: true },
    body: { type: String, default: '' },
    /** Internal notes are visible to support staff only. */
    internal: { type: Boolean, default: false },
    attachments: { type: [attachmentSchema], default: [] },
    readBy: { type: [new Schema({ userId: String, at: Date }, { _id: false })], default: [] },
    editedAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'ticket_messages', versionKey: false },
);
messageSchema.index({ ticketId: 1, createdAt: 1 });
export const TicketMessage = model('TicketMessage', messageSchema);

const cannedSchema = new Schema(
  {
    title: { type: String, required: true, trim: true },
    body: { type: String, required: true },
    tags: { type: [String], default: [] },
    createdBy: { type: String, required: true },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'canned_responses', versionKey: false },
);
export const CannedResponse = model('CannedResponse', cannedSchema);

/** "Escalate to officer" (§11): an internal task for the land office. */
const escalationSchema = new Schema(
  {
    ticketId: { type: Schema.Types.ObjectId, required: true, index: true },
    ticketNumber: { type: String, required: true },
    note: { type: String, required: true },
    parcelId: { type: String, default: null },
    transferId: { type: String, default: null },
    status: { type: String, enum: ['OPEN', 'DONE'], default: 'OPEN', index: true },
    createdBy: { type: String, required: true },
    doneBy: { type: String, default: null },
    doneAt: { type: Date, default: null },
    resolution: { type: String, default: null },
  },
  { timestamps: true, collection: 'escalations', versionKey: false },
);
export const Escalation = model('Escalation', escalationSchema);

const counterSchema = new Schema({ _id: { type: String, required: true }, seq: { type: Number, default: 0 } }, { collection: 'counters', versionKey: false });
export const Counter = model('Counter', counterSchema);

export async function nextTicketNumber(): Promise<string> {
  const c = await Counter.findOneAndUpdate({ _id: 'ticket' }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: 'after' }).lean();
  return `MLK-${String(c!.seq).padStart(6, '0')}`;
}
