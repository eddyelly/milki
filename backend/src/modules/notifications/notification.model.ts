import { type InferSchemaType, model, Schema } from 'mongoose';

const notificationSchema = new Schema(
  {
    userId: { type: String, required: true, index: true },
    type: { type: String, required: true },
    title: { type: String, required: true },
    body: { type: String, required: true },
    /** Deep-link context: parcelId, transferId, txId… Never PII. */
    data: { type: Schema.Types.Mixed, default: {} },
    readAt: { type: Date, default: null, index: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'notifications', versionKey: false },
);
notificationSchema.index({ userId: 1, createdAt: -1 });

export type NotificationAttrs = InferSchemaType<typeof notificationSchema>;
export const Notification = model('Notification', notificationSchema);

/** FCM device tokens (CLAUDE.md §7.2): created on login, refreshed, removed on logout. */
const deviceTokenSchema = new Schema(
  {
    userId: { type: String, required: true, index: true },
    token: { type: String, required: true, unique: true },
    platform: { type: String, enum: ['android', 'ios', 'web'], required: true },
    lastSeenAt: { type: Date, default: () => new Date() },
  },
  { timestamps: true, collection: 'device_tokens', versionKey: false },
);

export const DeviceToken = model('DeviceToken', deviceTokenSchema);
