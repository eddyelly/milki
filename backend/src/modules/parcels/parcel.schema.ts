import { z } from 'zod';
import { nidaSchema } from '../auth/auth.schema';
import { LAND_USES, PARCEL_STATUSES } from './parcel.types';

export const PARCEL_ID_RE = /^[A-Z]{2,4}-[A-Z]{2,4}-[0-9A-Z]{1,8}-[0-9A-Z]{1,8}$/;

export const parcelParams = z.object({
  parcelId: z
    .string()
    .transform((s) => s.toUpperCase())
    .pipe(z.string().regex(PARCEL_ID_RE, 'Parcel IDs look like DSM-KIN-12-45.')),
});

const SORTS = ['updatedAt', '-updatedAt', 'parcelId', '-parcelId', 'area', '-area', 'createdAt', '-createdAt'] as const;

export const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(100).optional(),
  status: z
    .string()
    .transform((s) => s.split(',').filter(Boolean))
    .pipe(z.array(z.enum(PARCEL_STATUSES)))
    .optional(),
  region: z.string().trim().max(80).optional(),
  district: z.string().trim().max(80).optional(),
  landUse: z.enum(LAND_USES).optional(),
  ownerId: z.string().max(64).optional(),
  sort: z.enum(SORTS).default('-updatedAt'),
});

const location = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  boundary: z.array(z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)])).min(3).max(500).nullish(),
  address: z.string().trim().max(200).nullish(),
});

/** Who the parcel is registered to: an existing citizen, by Milki user ID or NIDA number. */
const ownerRef = z.union([z.object({ userId: z.string().regex(/^usr_[a-f0-9]{24}$/) }), z.object({ nida: nidaSchema })]);

export const registerParcelBody = z.object({
  parcelId: z
    .string()
    .transform((s) => s.trim().toUpperCase())
    .pipe(z.string().regex(PARCEL_ID_RE, 'Parcel IDs look like DSM-KIN-12-45.')),
  titleNumber: z.string().trim().min(1).max(40).regex(/^[A-Za-z0-9/-]+$/, 'Use letters, digits, / and - only.'),
  region: z.string().trim().min(1).max(80),
  district: z.string().trim().min(1).max(80),
  ward: z.string().trim().min(1).max(80),
  blockNumber: z.string().trim().min(1).max(20),
  plotNumber: z.string().trim().min(1).max(20),
  area: z.number().positive().max(1_000_000_000),
  landUse: z.enum(LAND_USES),
  location,
  owner: ownerRef,
});

export const updateParcelBody = z
  .object({
    landUse: z.enum(LAND_USES).optional(),
    area: z.number().positive().max(1_000_000_000).optional(),
    areaCorrectionReason: z.string().trim().min(3).max(500).optional(),
    location: location.optional(),
  })
  .strict()
  .refine((b) => b.landUse !== undefined || b.area !== undefined || b.location !== undefined, 'Provide landUse, area or location.')
  .refine((b) => b.area === undefined || b.areaCorrectionReason !== undefined, {
    message: 'An area correction needs a reason.',
    path: ['areaCorrectionReason'],
  });

export const reasonBody = z.object({ reason: z.string().trim().min(3, 'Give a reason (at least 3 characters).').max(500) });

export type ListQuery = z.infer<typeof listQuery>;
export type RegisterParcelBody = z.infer<typeof registerParcelBody>;
export type UpdateParcelBody = z.infer<typeof updateParcelBody>;
