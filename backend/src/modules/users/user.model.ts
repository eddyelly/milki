import { type HydratedDocument, type InferSchemaType, model, Schema } from 'mongoose';
import { ROLES } from '../../core/roles';

const sealedSchema = new Schema({ iv: String, tag: String, ct: String }, { _id: false });

const userSchema = new Schema(
  {
    /** Public, opaque user ID — also the Fabric CA enrollment ID and the on-chain owner/party ID. */
    userId: { type: String, required: true, unique: true },
    role: { type: String, enum: ROLES, required: true, index: true },
    fullName: { type: String, required: true, trim: true },
    email: { type: String, lowercase: true, trim: true, unique: true, sparse: true },
    /** E.164, e.g. +255712345678. */
    phone: { type: String, required: true, unique: true },
    passwordHash: { type: String, required: true },
    /** HMAC of the NIDA number — the same value is used on-chain (ownerNidaHash). */
    nidaHash: { type: String, unique: true, sparse: true },
    nidaSealed: { type: sealedSchema, default: undefined },
    nidaLast4: { type: String },
    status: { type: String, enum: ['PENDING_VERIFICATION', 'ACTIVE', 'DEACTIVATED'], default: 'PENDING_VERIFICATION', index: true },
    /** Bank code for BANK_OFFICER (written into the Fabric certificate as attribute `bank`). */
    bankCode: { type: String },
    bankName: { type: String },
    officeId: { type: String },
    preferredLanguage: { type: String, enum: ['en', 'sw'], default: 'en' },
    fabric: {
      enrolled: { type: Boolean, default: false },
      mspId: { type: String },
      enrolledAt: { type: Date },
      lastError: { type: String },
    },
    lastLoginAt: { type: Date },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

userSchema.index({ fullName: 'text', email: 'text' });

export type UserAttrs = InferSchemaType<typeof userSchema>;
export type UserDoc = HydratedDocument<UserAttrs>;
export const User = model('User', userSchema);

/** Shape returned by the API — never hashes, sealed values or the full NIDA. */
export function publicUser(u: UserDoc) {
  return {
    userId: u.userId,
    role: u.role,
    fullName: u.fullName,
    email: u.email ?? null,
    phone: u.phone,
    nidaMasked: u.nidaLast4 ? `••••••••••••••••${u.nidaLast4}` : null,
    status: u.status,
    bankCode: u.bankCode ?? null,
    bankName: u.bankName ?? null,
    officeId: u.officeId ?? null,
    preferredLanguage: u.preferredLanguage,
    ledgerIdentity: { enrolled: u.fabric?.enrolled ?? false, mspId: u.fabric?.mspId ?? null },
    lastLoginAt: u.lastLoginAt ?? null,
    createdAt: (u as unknown as { createdAt: Date }).createdAt,
  };
}
export type PublicUser = ReturnType<typeof publicUser>;
