import { type InferSchemaType, model, Schema } from 'mongoose';

/**
 * Off-chain metadata for a file in MinIO. The ledger only stores its SHA-256 (rule 5); this record links
 * that on-chain document reference to the object key, MIME type and size.
 */
const documentFileSchema = new Schema(
  {
    /** On-chain document ID (DOC-…), known as soon as endorsement returns. */
    documentId: { type: String, unique: true, sparse: true },
    sha256: { type: String, required: true, index: true },
    objectKey: { type: String, required: true },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true },
    originalName: { type: String },
    targetType: { type: String, enum: ['PARCEL', 'TRANSFER'], required: true },
    targetId: { type: String, required: true, index: true },
    documentType: { type: String, required: true },
    version: { type: Number, default: 1 },
    supersedes: { type: String },
    uploadedBy: { type: String, required: true },
    txId: { type: String },
    status: { type: String, enum: ['SUBMITTED', 'ATTACHED', 'SUPERSEDED'], default: 'SUBMITTED' },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'document_files' },
);

export type DocumentFileAttrs = InferSchemaType<typeof documentFileSchema>;
export const DocumentFile = model('DocumentFile', documentFileSchema);
