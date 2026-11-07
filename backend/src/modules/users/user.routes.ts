import { type Request, type Response, Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../../core/auth';
import { piiHash } from '../../core/crypto';
import { notFound } from '../../core/errors';
import { input, ok, validate } from '../../core/http';
import { nidaSchema, phoneSchema } from '../auth/auth.schema';
import { User } from './user.model';
import { displayName } from './user.service';

export const userRouter = Router();
userRouter.use(requireAuth);

const lookupQuery = z.union([z.object({ phone: phoneSchema }), z.object({ nida: nidaSchema })]);

/**
 * Finds an active landowner by phone or NIDA so a seller (or registrar) can confirm who they are dealing with.
 * Returns only an opaque ID and a short display name ("Juma H.").
 */
userRouter.get(
  '/lookup',
  requireRole('CITIZEN', 'REGISTRAR', 'LAND_OFFICER'),
  validate({ query: lookupQuery }),
  async (req: Request, res: Response) => {
    const q = input<{ phone: string } | { nida: string }>(req, 'query');
    const filter = 'phone' in q ? { phone: q.phone } : { nidaHash: piiHash(q.nida) };
    const user = await User.findOne({ ...filter, role: 'CITIZEN', status: 'ACTIVE', deletedAt: null }, { userId: 1, fullName: 1 }).lean();
    if (!user) throw notFound('No active Milki landowner has that phone or NIDA number.', 'USER_NOT_FOUND');
    return ok(res, { userId: user.userId, displayName: displayName(user.fullName) });
  },
);
