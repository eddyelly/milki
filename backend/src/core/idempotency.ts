import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { sha256Hex } from './crypto';
import { redis } from './datastores';
import { AppError, badRequest, conflict } from './errors';

const TTL_SECONDS = 24 * 60 * 60;
const KEY_RE = /^[A-Za-z0-9_.:-]{8,128}$/;

interface Stored {
  state: 'processing' | 'done';
  fingerprint: string;
  status?: number;
  body?: unknown;
}

/**
 * Every write sends an `Idempotency-Key` (CLAUDE.md §8). Keys live in Redis for 24 h:
 *  - same key while the first request is running → 409 REQUEST_IN_PROGRESS;
 *  - same key after it finished → the original response is replayed (header `Idempotent-Replayed: true`),
 *    so a retried ledger write never submits twice;
 *  - same key with a different body → 422 IDEMPOTENCY_KEY_REUSED;
 *  - only 2xx responses are stored; any error releases the key so the client can fix the problem
 *    (e.g. re-authenticate) and retry with the same key.
 */
export const idempotent: RequestHandler = async (req: Request, res: Response, next: NextFunction) => {
  const key = req.header('idempotency-key');
  if (!key) return next(badRequest('Missing Idempotency-Key header.', undefined, 'IDEMPOTENCY_KEY_REQUIRED'));
  if (!KEY_RE.test(key)) return next(badRequest('Idempotency-Key must be 8–128 URL-safe characters.', undefined, 'IDEMPOTENCY_KEY_INVALID'));

  const scope = req.user?.userId ?? `ip:${req.ip}`;
  const redisKey = `idem:${scope}:${req.method}:${req.baseUrl}${req.path}:${key}`;
  const fingerprint = sha256Hex(JSON.stringify(req.body ?? null));

  const placed = await redis.set(redisKey, JSON.stringify({ state: 'processing', fingerprint } satisfies Stored), 'EX', TTL_SECONDS, 'NX');
  if (placed !== 'OK') {
    const raw = await redis.get(redisKey);
    const stored = raw ? (JSON.parse(raw) as Stored) : null;
    if (stored && stored.fingerprint !== fingerprint) {
      return next(new AppError(422, 'IDEMPOTENCY_KEY_REUSED', 'This Idempotency-Key was already used for a different request.'));
    }
    if (!stored || stored.state === 'processing') {
      return next(conflict('This request is already being processed.', undefined, 'REQUEST_IN_PROGRESS'));
    }
    res.setHeader('Idempotent-Replayed', 'true');
    return res.status(stored.status ?? 200).json(stored.body);
  }

  const originalJson = res.json.bind(res);
  res.json = (body: unknown) => {
    const status = res.statusCode;
    const write =
      status >= 400
        ? redis.del(redisKey)
        : redis.set(redisKey, JSON.stringify({ state: 'done', fingerprint, status, body } satisfies Stored), 'EX', TTL_SECONDS);
    write.catch(() => undefined);
    return originalJson(body);
  };
  next();
};
