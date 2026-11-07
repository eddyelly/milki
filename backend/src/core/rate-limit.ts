import { rateLimit } from 'express-rate-limit';
import { RedisStore, type RedisReply } from 'rate-limit-redis';
import { env } from '../config/env';
import { redis } from './datastores';

const store = (prefix: string) =>
  new RedisStore({
    prefix: `rl:${prefix}:`,
    sendCommand: (command: string, ...args: string[]) => redis.call(command, ...args) as Promise<RedisReply>,
  });

const limitedResponse = (message: string) => ({ error: { code: 'RATE_LIMITED', message, details: null } });

/** Sign-in, registration and OTP endpoints. */
export const authLimiter = rateLimit({
  windowMs: 60_000,
  limit: env.AUTH_RATE_LIMIT_PER_MIN,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  store: store('auth'),
  message: limitedResponse('Too many attempts. Please wait a minute and try again.'),
});
