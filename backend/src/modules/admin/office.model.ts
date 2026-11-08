import { model, Schema } from 'mongoose';

/** Land offices / regions (CLAUDE.md §7.2): admin-managed, soft delete. Staff can be attached to one. */
const officeSchema = new Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    region: { type: String, required: true, trim: true, index: true },
    district: { type: String, required: true, trim: true },
    address: { type: String, default: '' },
    phone: { type: String, default: '' },
    email: { type: String, default: '' },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'land_offices', versionKey: false },
);
export const LandOffice = model('LandOffice', officeSchema);
