import { env } from '../../config/env';
import { AppError, unavailable } from '../errors';
import { logger } from '../logger';
import { emitToUser } from '../socket';
import { openGateway } from './gateway';
import { LedgerTx } from './ledger-tx.model';
import { serviceIdentity, userIdentity, type WalletUser } from './wallet';

// -------------------------------------------------------------------------------------------------
// Error mapping — chaincode errors are JSON `{ code, message, details? }` (CLAUDE.md §7.1).
// -------------------------------------------------------------------------------------------------
const STATUS_BY_CODE: Record<string, number> = {
  INVALID_ARGUMENT: 400,
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  CONFLICT: 409,
  INVALID_STATE: 409,
  PARCEL_ENCUMBERED: 409,
  PARCEL_DISPUTED: 409,
  PARCEL_FROZEN: 409,
  PARCEL_RETIRED: 409,
  TRANSFER_IN_PROGRESS: 409,
};

interface ChaincodeErrorBody {
  code: string;
  message: string;
  details?: unknown;
}

function findChaincodeError(text: string): ChaincodeErrorBody | null {
  const start = text.indexOf('{"code"');
  if (start < 0) return null;
  // The JSON runs to the matching brace; peers may append text after it.
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) {
      try {
        const parsed = JSON.parse(text.slice(start, i + 1)) as ChaincodeErrorBody;
        return typeof parsed.code === 'string' && typeof parsed.message === 'string' ? parsed : null;
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** gRPC status codes that mean "the network is down or slow", not "your request is wrong". */
const UNREACHABLE = new Set([4 /* DEADLINE_EXCEEDED */, 14 /* UNAVAILABLE */]);

export function mapLedgerError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  const e = err as { message?: string; code?: number; details?: { message?: string }[] };
  const texts = [...(e.details ?? []).map((d) => d.message ?? ''), e.message ?? ''];
  for (const t of texts) {
    const cc = findChaincodeError(t);
    if (cc) return new AppError(STATUS_BY_CODE[cc.code] ?? 400, cc.code, cc.message, cc.details ?? null);
  }
  if (typeof e.code === 'number' && UNREACHABLE.has(e.code)) {
    return unavailable('The land registry network is not reachable right now. Please try again shortly.', 'LEDGER_UNAVAILABLE');
  }
  logger.error({ err }, 'unexpected ledger error');
  return new AppError(502, 'LEDGER_ERROR', 'The land registry could not process this request. Please try again.');
}

// -------------------------------------------------------------------------------------------------
// Evaluate / submit
// -------------------------------------------------------------------------------------------------
const decoder = new TextDecoder();
const encoder = new TextEncoder();

function parseResult<T>(bytes: Uint8Array): T {
  const text = decoder.decode(bytes);
  return (text ? JSON.parse(text) : null) as T;
}

function assertEnabled(): void {
  if (!env.FABRIC_ENABLED) throw unavailable('The land registry network is disabled in this environment.', 'LEDGER_DISABLED');
}

/** Read-only query. `'service'` uses the backend's role-less identity (for public verification, listeners). */
export async function evaluate<T>(who: WalletUser | 'service', fn: string, args: string[] = []): Promise<T> {
  assertEnabled();
  try {
    const identity = who === 'service' ? await serviceIdentity('org1') : await userIdentity(who);
    const { gateway, contract } = openGateway(identity);
    try {
      return parseResult<T>(await contract.evaluateTransaction(fn, ...args));
    } finally {
      gateway.close();
    }
  } catch (err) {
    throw mapLedgerError(err);
  }
}

export interface SubmitOptions {
  /** Private data, sent in the transient map (never in args — rule 4). */
  transient?: Record<string, unknown>;
  entityType?: string;
  entityId?: string;
}

export interface SubmitResult<T> {
  txId: string;
  result: T;
}

/**
 * Endorses and submits as the user, then returns immediately with the txId (endorsement errors — guards —
 * surface synchronously). Commit status is awaited in the background and pushed as Socket.IO `ledger:tx`.
 */
export async function submit<T>(user: WalletUser, fn: string, args: string[], opts: SubmitOptions = {}): Promise<SubmitResult<T>> {
  assertEnabled();
  let identity;
  try {
    identity = await userIdentity(user);
  } catch (err) {
    logger.error({ err, userId: user.userId }, 'could not obtain ledger identity');
    throw unavailable('We could not reach the certificate authority to set up your ledger identity. Please try again.', 'LEDGER_IDENTITY_UNAVAILABLE');
  }
  const { gateway, contract } = openGateway(identity);
  let submitted;
  try {
    const transientData = opts.transient
      ? Object.fromEntries(Object.entries(opts.transient).map(([k, v]) => [k, encoder.encode(JSON.stringify(v))]))
      : undefined;
    submitted = await contract.submitAsync(fn, { arguments: args, ...(transientData ? { transientData } : {}) });
  } catch (err) {
    gateway.close();
    throw mapLedgerError(err);
  }

  const txId = submitted.getTransactionId();
  const result = parseResult<T>(submitted.getResult());
  await LedgerTx.create({ txId, userId: user.userId, fn, entityType: opts.entityType, entityId: opts.entityId });

  void (async () => {
    try {
      const status = await submitted.getStatus();
      const update = {
        status: status.successful ? 'COMMITTED' : 'FAILED',
        blockNumber: Number(status.blockNumber),
        validationCode: String(status.code),
        committedAt: new Date(),
      } as const;
      await LedgerTx.updateOne({ txId }, update);
      emitToUser(user.userId, 'ledger:tx', { txId, fn, entityType: opts.entityType ?? null, entityId: opts.entityId ?? null, ...update });
      if (!status.successful) logger.warn({ txId, code: status.code }, 'transaction failed validation');
    } catch (err) {
      logger.error({ err, txId }, 'commit status unavailable');
      await LedgerTx.updateOne({ txId }, { status: 'FAILED', validationCode: 'COMMIT_STATUS_UNAVAILABLE' }).catch(() => undefined);
      emitToUser(user.userId, 'ledger:tx', { txId, fn, status: 'FAILED', validationCode: 'COMMIT_STATUS_UNAVAILABLE' });
    } finally {
      gateway.close();
    }
  })();

  return { txId, result };
}

/** Facade so modules (and tests) depend on one object. */
export const ledger = { evaluate, submit };
