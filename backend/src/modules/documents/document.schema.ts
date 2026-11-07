import { z } from 'zod';

export const DOCUMENT_TYPES = [
  'TITLE_DEED',
  'SALE_AGREEMENT',
  'SURVEY_PLAN',
  'ID_COPY',
  'TAX_RECEIPT',
  'PAYMENT_PROOF',
  'VALUATION_REPORT',
  'MORTGAGE_DEED',
  'COURT_ORDER',
  'OTHER',
] as const;

const sha = z.string().regex(/^[a-f0-9]{64}$/, 'sha256 must be 64 lowercase hex characters.');

/** Multipart text fields that accompany `file`. `sha256` is optional: the client's own hash, for the in-transit check. */
export const uploadBody = z
  .object({
    targetType: z.enum(['PARCEL', 'TRANSFER']),
    targetId: z.string().trim().toUpperCase().min(5).max(40),
    documentType: z.enum(DOCUMENT_TYPES),
    sha256: sha.optional(),
  })
  .superRefine((b, ctx) => {
    const re = b.targetType === 'PARCEL' ? /^[A-Z]{2,4}-[A-Z]{2,4}-[0-9A-Z]{1,8}-[0-9A-Z]{1,8}$/ : /^TRF-[A-F0-9]{16}$/;
    if (!re.test(b.targetId)) ctx.addIssue({ code: 'custom', path: ['targetId'], message: `Not a valid ${b.targetType.toLowerCase()} ID.` });
  });

export const supersedeBody = z.object({ sha256: sha.optional() });

export const documentParams = z.object({
  documentId: z
    .string()
    .transform((s) => s.toUpperCase())
    .pipe(z.string().regex(/^DOC-[A-F0-9]{16}$/, 'Document IDs look like DOC-0A1B2C3D4E5F6789.')),
});

export type UploadBody = z.infer<typeof uploadBody>;
