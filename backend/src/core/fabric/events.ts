import type { ChaincodeEvent, CloseableAsyncIterable } from '@hyperledger/fabric-gateway';
import { model, Schema } from 'mongoose';
import { env } from '../../config/env';
import { logger } from '../logger';
import { openGateway } from './gateway';
import { serviceIdentity } from './wallet';

/** Payload every chaincode event carries (chaincode/src/ledger.ts → MilkiEvent). */
export interface MilkiEvent {
  entity: string;
  action: string;
  id: string;
  parcelId: string;
  status: string;
  txId: string;
  timestamp: string;
  actor: { id: string; mspId: string; role: string | null };
  data?: Record<string, string | number | boolean | null>;
}

export interface EventContext {
  name: string;
  blockNumber: number;
  transactionId: string;
}

export type EventHandler = (event: MilkiEvent, ctx: EventContext) => Promise<void>;

const handlers: EventHandler[] = [];

/** Modules register handlers (cache upserts, audit, notifications). They run in order for every event. */
export function onLedgerEvent(handler: EventHandler): void {
  handlers.push(handler);
}

// Persisted checkpoint so a restart resumes exactly after the last processed event.
const checkpointSchema = new Schema({ _id: String, blockNumber: String, transactionId: String }, { versionKey: false, collection: 'checkpoints' });
const Checkpoint = model('Checkpoint', checkpointSchema);
const CHECKPOINT_ID = 'land-registry-events';

let stopped = false;
let current: CloseableAsyncIterable<ChaincodeEvent> | null = null;
const decoder = new TextDecoder();

export async function dispatch(event: MilkiEvent, ctx: EventContext): Promise<void> {
  for (const h of handlers) {
    try {
      await h(event, ctx);
    } catch (err) {
      logger.error({ err, event: ctx.name, txId: ctx.transactionId }, 'ledger event handler failed');
    }
  }
}

async function runOnce(): Promise<void> {
  const identity = await serviceIdentity('org1');
  const { gateway, network } = openGateway(identity);
  try {
    const saved = await Checkpoint.findById(CHECKPOINT_ID).lean();
    const checkpoint = saved
      ? { getBlockNumber: () => BigInt(saved.blockNumber ?? '0'), getTransactionId: () => saved.transactionId ?? undefined }
      : undefined;
    current = await network.getChaincodeEvents(env.FABRIC_CHAINCODE, checkpoint ? { checkpoint } : { startBlock: 0n });
    logger.info({ from: saved?.blockNumber ?? '0' }, 'listening for chaincode events');
    for await (const ev of current) {
      if (!ev.eventName.startsWith('milki.')) continue;
      const payload = JSON.parse(decoder.decode(ev.payload)) as MilkiEvent;
      await dispatch(payload, { name: ev.eventName, blockNumber: Number(ev.blockNumber), transactionId: ev.transactionId });
      await Checkpoint.updateOne(
        { _id: CHECKPOINT_ID },
        { blockNumber: ev.blockNumber.toString(), transactionId: ev.transactionId },
        { upsert: true },
      );
    }
  } finally {
    current?.close();
    current = null;
    gateway.close();
  }
}

/** Long-running listener with reconnect + backoff. Replays from block 0 on first start to rebuild caches. */
export function startEventListener(): void {
  stopped = false;
  void (async () => {
    let delay = 1000;
    while (!stopped) {
      try {
        await runOnce();
        delay = 1000;
      } catch (err) {
        if (stopped) break;
        logger.warn({ err: (err as Error).message, retryInMs: delay }, 'chaincode event stream interrupted');
        await new Promise((r) => setTimeout(r, delay));
        delay = Math.min(delay * 2, 30_000);
      }
    }
  })();
}

export function stopEventListener(): void {
  stopped = true;
  current?.close();
}
