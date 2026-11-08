import { type Request, type Response, Router } from 'express';
import { isValidObjectId } from 'mongoose';
import { z } from 'zod';
import { currentUser, requireAuth } from '../../core/auth';
import { notFound } from '../../core/errors';
import { input, ok, pageMeta, validate } from '../../core/http';
import { DeviceToken, Notification } from './notification.model';

export const notificationRouter = Router();
notificationRouter.use(requireAuth);

const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  unread: z.enum(['true', 'false']).optional(),
});
const idParams = z.object({ id: z.string().refine(isValidObjectId, 'Not a notification ID.') });

notificationRouter.get('/', validate({ query: listQuery }), async (req: Request, res: Response) => {
  const q = input<z.infer<typeof listQuery>>(req, 'query');
  const filter = { userId: currentUser(req).userId, ...(q.unread === 'true' ? { readAt: null } : {}) };
  const [items, total, unread] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1 }).skip((q.page - 1) * q.limit).limit(q.limit).lean(),
    Notification.countDocuments(filter),
    Notification.countDocuments({ userId: currentUser(req).userId, readAt: null }),
  ]);
  return ok(res, items, { ...pageMeta(q, total), unread });
});

notificationRouter.post('/read-all', async (req: Request, res: Response) => {
  const r = await Notification.updateMany({ userId: currentUser(req).userId, readAt: null }, { readAt: new Date() });
  return ok(res, { updated: r.modifiedCount });
});

notificationRouter.post('/:id/read', validate({ params: idParams }), async (req: Request, res: Response) => {
  const n = await Notification.findOneAndUpdate(
    { _id: input<{ id: string }>(req, 'params').id, userId: currentUser(req).userId },
    { $set: { readAt: new Date() } },
    { returnDocument: 'after' },
  ).lean();
  if (!n) throw notFound('Notification not found.');
  return ok(res, n);
});

notificationRouter.delete('/:id', validate({ params: idParams }), async (req: Request, res: Response) => {
  const r = await Notification.deleteOne({ _id: input<{ id: string }>(req, 'params').id, userId: currentUser(req).userId });
  if (r.deletedCount === 0) throw notFound('Notification not found.');
  return ok(res, { deleted: true });
});

// -------------------------------------------------------------------------- FCM device tokens
export const deviceRouter = Router();
deviceRouter.use(requireAuth);

const deviceBody = z.object({ token: z.string().min(20).max(4096), platform: z.enum(['android', 'ios', 'web']) });

/** Register or refresh this device's push token (called after sign-in and on token refresh). */
deviceRouter.post('/', validate({ body: deviceBody }), async (req: Request, res: Response) => {
  const { token, platform } = input<z.infer<typeof deviceBody>>(req, 'body');
  await DeviceToken.updateOne({ token }, { userId: currentUser(req).userId, platform, lastSeenAt: new Date() }, { upsert: true });
  return ok(res, { registered: true });
});

/** Remove on sign-out. */
deviceRouter.delete('/:token', async (req: Request, res: Response) => {
  await DeviceToken.deleteOne({ token: String(req.params.token), userId: currentUser(req).userId });
  return ok(res, { removed: true });
});
