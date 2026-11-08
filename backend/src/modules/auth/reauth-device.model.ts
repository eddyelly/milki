import { model, Schema } from 'mongoose';

/**
 * Mobile biometric re-authentication (CLAUDE.md §8, T3): a per-device secret created once with the password,
 * stored on the phone in the Keystore/Keychain behind biometrics (or the device PIN). Only its SHA-256 is kept here.
 */
const reauthDeviceSchema = new Schema(
  {
    userId: { type: String, required: true, index: true },
    deviceId: { type: String, required: true },
    deviceName: { type: String },
    secretHash: { type: String, required: true },
    lastUsedAt: { type: Date },
    revokedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'reauth_devices', versionKey: false },
);
reauthDeviceSchema.index({ userId: 1, deviceId: 1 }, { unique: true });

export const ReauthDevice = model('ReauthDevice', reauthDeviceSchema);
