import { type Request, type Response, Router } from 'express';
import mongoose from 'mongoose';
import { env } from '../../config/env';
import { redis } from '../../core/datastores';
import { ledger } from '../../core/fabric/ledger';

export const healthRouter = Router();

const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
  Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);

async function check(fn: () => Promise<unknown>): Promise<{ ok: boolean; detail?: string }> {
  try {
    const detail = await withTimeout(fn(), 3000);
    return { ok: true, ...(typeof detail === 'string' ? { detail } : {}) };
  } catch (err) {
    return { ok: false, detail: (err as Error).message };
  }
}

healthRouter.get('/live', (_req: Request, res: Response) => res.json({ data: { status: 'ok' }, meta: null }));

healthRouter.get('/', async (_req: Request, res: Response) => {
  const [mongo, cache, chain] = await Promise.all([
    check(async () => {
      if (mongoose.connection.readyState !== 1) throw new Error('not connected');
      await mongoose.connection.db?.admin().ping();
    }),
    check(() => redis.ping()),
    env.FABRIC_ENABLED
      ? check(async () => {
          const info = await ledger.evaluate<{ name: string; version: string }>('service', 'GetContractInfo');
          return `${info.name}@${info.version}`;
        })
      : Promise.resolve({ ok: false, detail: 'disabled' }),
  ]);
  const healthy = mongo.ok && cache.ok && (chain.ok || !env.FABRIC_ENABLED);
  res.status(healthy ? 200 : 503).json({ data: { status: healthy ? 'ok' : 'degraded', mongo, redis: cache, ledger: chain }, meta: null });
});
