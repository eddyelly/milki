import { existsSync, readFileSync } from 'node:fs';
import { Queue, Worker } from 'bullmq';
import { type App, cert, initializeApp } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { env, isTest } from '../../config/env';
import { newBullConnection } from '../../core/datastores';
import { logger } from '../../core/logger';
import { emitToUser } from '../../core/socket';
import { User } from '../users/user.model';
import { DeviceToken, Notification } from './notification.model';

export type Lang = 'en' | 'sw';
export type Localized = Record<Lang, string>;

/** One notification for some users; title/body in English and Swahili, picked per user. */
export interface NotificationJob {
  userIds: string[];
  type: string;
  title: Localized;
  body: Localized;
  data: Record<string, string | number | null>;
}

// ----------------------------------------------------------------------------------------- FCM
let fcm: App | null | undefined;

function firebase(): App | null {
  if (fcm !== undefined) return fcm;
  try {
    if (!existsSync(env.FCM_SERVICE_ACCOUNT_PATH)) {
      logger.info('FCM service account not found — push notifications disabled (in-app + socket still work)');
      fcm = null;
    } else {
      fcm = initializeApp({ credential: cert(JSON.parse(readFileSync(env.FCM_SERVICE_ACCOUNT_PATH, 'utf8')) as Record<string, string>) }, 'milki');
    }
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'FCM init failed — push disabled');
    fcm = null;
  }
  return fcm;
}

async function push(userId: string, title: string, body: string, data: Record<string, string>): Promise<void> {
  const app = firebase();
  if (!app) return;
  const tokens = (await DeviceToken.find({ userId }, { token: 1 }).lean()).map((t) => t.token);
  if (tokens.length === 0) return;
  const res = await getMessaging(app).sendEachForMulticast({ tokens, notification: { title, body }, data });
  const dead = res.responses
    .map((r, i) => (r.error?.code === 'messaging/registration-token-not-registered' ? tokens[i] : null))
    .filter((t): t is string => t !== null);
  if (dead.length) await DeviceToken.deleteMany({ token: { $in: dead } });
}

// ---------------------------------------------------------------------------------------- delivery
/** Stores the in-app notification, emits it over Socket.IO and sends a push, in each user's language. */
export async function deliver(job: NotificationJob): Promise<void> {
  const users = await User.find({ userId: { $in: job.userIds } }, { userId: 1, preferredLanguage: 1 }).lean();
  for (const u of users) {
    const lang: Lang = u.preferredLanguage === 'sw' ? 'sw' : 'en';
    const doc = await Notification.create({ userId: u.userId, type: job.type, title: job.title[lang], body: job.body[lang], data: job.data });
    emitToUser(u.userId, 'notification', doc.toObject());
    const flat = Object.fromEntries(Object.entries(job.data).map(([k, v]) => [k, String(v ?? '')]));
    await push(u.userId, job.title[lang], job.body[lang], { ...flat, type: job.type, notificationId: String(doc._id) }).catch((err: Error) =>
      logger.warn({ err: err.message, userId: u.userId }, 'push failed'),
    );
  }
}

let queue: Queue<NotificationJob> | null = null;
let worker: Worker<NotificationJob> | null = null;

/** BullMQ `notifications` queue (CLAUDE.md §12); delivered inline in tests. */
export async function enqueueNotification(job: NotificationJob): Promise<void> {
  if (job.userIds.length === 0) return;
  if (isTest) return deliver(job);
  queue ??= new Queue<NotificationJob>('notifications', {
    connection: newBullConnection(),
    defaultJobOptions: { attempts: 5, backoff: { type: 'exponential', delay: 2000 }, removeOnComplete: 1000, removeOnFail: 5000 },
  });
  await queue.add(job.type, job);
}

export function startNotificationWorker(): void {
  worker = new Worker<NotificationJob>('notifications', async (j) => deliver(j.data), { connection: newBullConnection(), concurrency: 5 });
  worker.on('failed', (j, err) => logger.warn({ jobId: j?.id, err: err.message }, 'notification delivery failed'));
}

export async function stopNotificationWorker(): Promise<void> {
  await worker?.close();
  await queue?.close();
}
