import { Redis } from 'ioredis';
import mongoose from 'mongoose';
import { env } from '../config/env';
import { logger } from './logger';

/** Shared Redis connection (OTP, denylist, idempotency, rate limits, hot cache). */
export const redis = new Redis(env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 3 });
redis.on('error', (err: Error) => logger.warn({ err: err.message }, 'redis error'));

/** BullMQ needs its own connections with maxRetriesPerRequest: null. */
export const newBullConnection = (): Redis => new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

export async function connectDatastores(): Promise<void> {
  mongoose.set('strictQuery', true);
  await mongoose.connect(env.MONGO_URI, { serverSelectionTimeoutMS: 5000 });
  if (redis.status === 'wait') await redis.connect();
  logger.info('connected to MongoDB and Redis');
}

export async function disconnectDatastores(): Promise<void> {
  await mongoose.disconnect();
  if (redis.status !== 'end') await redis.quit().catch(() => undefined);
}
