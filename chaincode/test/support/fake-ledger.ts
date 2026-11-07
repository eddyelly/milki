import { createHash } from 'node:crypto';
import type { Context } from 'fabric-contract-api';
import sinon from 'sinon';

/**
 * In-memory stand-in for a Fabric peer, faithful where it matters for chaincode logic:
 *  - writes are buffered and only committed if the transaction function resolves (atomicity);
 *  - reads see committed state only (Fabric does not expose a transaction's own writes);
 *  - only the last setEvent of a transaction survives;
 *  - history is returned newest-first, as LevelDB/CouchDB peers may do.
 */
export interface FakeIdentity {
  mspId: string;
  id: string;
  attrs: Record<string, string>;
}

interface HistoryEntry {
  txId: string;
  seconds: number;
  value: Uint8Array;
  isDelete: boolean;
}

export interface CommittedEvent {
  name: string;
  payload: Record<string, unknown>;
}

const decoder = new TextDecoder();
const encoder = new TextEncoder();

export class FakeLedger {
  readonly state = new Map<string, Uint8Array>();
  readonly privateData = new Map<string, Map<string, Uint8Array>>();
  readonly history = new Map<string, HistoryEntry[]>();
  readonly events: CommittedEvent[] = [];
  private txCounter = 0;
  /** 2026-01-01T00:00:00Z; each transaction advances one minute. */
  private seconds = 1_767_225_600;

  json<T>(key: string): T | undefined {
    const bytes = this.state.get(key);
    return bytes ? (JSON.parse(decoder.decode(bytes)) as T) : undefined;
  }

  privateJson<T>(collection: string, key: string): T | undefined {
    const bytes = this.privateData.get(collection)?.get(key);
    return bytes ? (JSON.parse(decoder.decode(bytes)) as T) : undefined;
  }

  lastEvent(): CommittedEvent | undefined {
    return this.events[this.events.length - 1];
  }

  /**
   * Runs `fn` as one transaction for `identity`. Commits buffered writes only if `fn` resolves.
   * `fcn` is what getFunctionAndParameters reports (used by unknownTransaction).
   */
  async transact<T>(
    identity: FakeIdentity,
    fn: (ctx: Context) => Promise<T>,
    opts: { transient?: Record<string, unknown>; fcn?: string } = {},
  ): Promise<T> {
    this.txCounter += 1;
    this.seconds += 60;
    const txId = createHash('sha256').update(`tx-${this.txCounter}`).digest('hex');
    const seconds = this.seconds;
    const writes = new Map<string, Uint8Array>();
    const privateWrites: { collection: string; key: string; value: Uint8Array }[] = [];
    let event: CommittedEvent | undefined;

    const transient = new Map<string, Uint8Array>();
    for (const [k, v] of Object.entries(opts.transient ?? {})) {
      transient.set(k, encoder.encode(typeof v === 'string' ? v : JSON.stringify(v)));
    }

    const stub = {
      getTxID: () => txId,
      getTxTimestamp: () => ({ seconds: { toString: () => String(seconds) }, nanos: 250_000_000 }),
      getState: async (key: string) => this.state.get(key) ?? new Uint8Array(0),
      putState: async (key: string, value: Uint8Array) => {
        writes.set(key, value);
      },
      getPrivateData: async (collection: string, key: string) => this.privateData.get(collection)?.get(key) ?? new Uint8Array(0),
      putPrivateData: async (collection: string, key: string, value: Uint8Array) => {
        privateWrites.push({ collection, key, value });
      },
      getTransient: () => transient,
      setEvent: (name: string, payload: Uint8Array) => {
        event = { name, payload: JSON.parse(decoder.decode(payload)) as Record<string, unknown> };
      },
      getFunctionAndParameters: () => ({ fcn: opts.fcn ?? 'Unknown', params: [] as string[] }),
      getHistoryForKey: async (key: string) => iterate([...(this.history.get(key) ?? [])].reverse().map(historyRow)),
      getQueryResultWithPagination: async (query: string, pageSize: number, bookmark?: string) =>
        this.richQuery(query, pageSize, bookmark ?? ''),
    };
    // Spies let tests assert on calls (e.g. private data written exactly once) without changing behaviour.
    sinon.spy(stub, 'putPrivateData');
    sinon.spy(stub, 'setEvent');

    const clientIdentity = {
      getMSPID: () => identity.mspId,
      getID: () =>
        `x509::/OU=client/OU=${identity.mspId.toLowerCase()}/CN=${identity.id}::/C=US/ST=North Carolina/O=Hyperledger/CN=ca.example.com`,
      getAttributeValue: (name: string) => identity.attrs[name] ?? null,
    };

    const ctx = { stub, clientIdentity } as unknown as Context;
    const result = await fn(ctx);

    // Commit.
    for (const [key, value] of writes) {
      this.state.set(key, value);
      const list = this.history.get(key) ?? [];
      list.push({ txId, seconds, value, isDelete: false });
      this.history.set(key, list);
    }
    for (const w of privateWrites) {
      const col = this.privateData.get(w.collection) ?? new Map<string, Uint8Array>();
      col.set(w.key, w.value);
      this.privateData.set(w.collection, col);
    }
    if (event) this.events.push(event);
    return result;
  }

  /** Minimal CouchDB selector support: equality and $in on (dotted) fields; sort on one field. */
  private richQuery(query: string, pageSize: number, bookmark: string) {
    const q = JSON.parse(query) as { selector: Record<string, unknown>; sort?: Record<string, 'asc' | 'desc'>[] };
    const rows: { key: string; doc: Record<string, unknown> }[] = [];
    for (const [key, bytes] of [...this.state.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
      const doc = JSON.parse(decoder.decode(bytes)) as Record<string, unknown>;
      if (matches(doc, q.selector)) rows.push({ key, doc });
    }
    const sortSpec = q.sort?.[0];
    if (sortSpec) {
      const [field, dir] = Object.entries(sortSpec)[0] as [string, 'asc' | 'desc'];
      rows.sort((a, b) => {
        const av = String(pick(a.doc, field));
        const bv = String(pick(b.doc, field));
        return (av < bv ? -1 : av > bv ? 1 : 0) * (dir === 'asc' ? 1 : -1);
      });
    }
    const start = bookmark ? Number(bookmark) : 0;
    const page = rows.slice(start, start + pageSize);
    const next = start + page.length;
    return {
      iterator: iterate(page.map((r) => ({ namespace: 'land-registry', key: r.key, value: encoder.encode(JSON.stringify(r.doc)) }))),
      metadata: { fetchedRecordsCount: page.length, bookmark: next < rows.length ? String(next) : '' },
    };
  }
}

function historyRow(h: HistoryEntry) {
  return { txId: h.txId, timestamp: { seconds: { toString: () => String(h.seconds) }, nanos: 0 }, isDelete: h.isDelete, value: h.value };
}

function pick(doc: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, part) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[part] : undefined), doc);
}

function matches(doc: Record<string, unknown>, selector: Record<string, unknown>): boolean {
  return Object.entries(selector).every(([field, cond]) => {
    const actual = pick(doc, field);
    if (cond !== null && typeof cond === 'object' && !Array.isArray(cond) && '$in' in cond) {
      return (cond as { $in: unknown[] }).$in.includes(actual);
    }
    return actual === cond;
  });
}

function iterate<T>(items: T[]) {
  let i = 0;
  const close = sinon.fake.resolves(undefined);
  return {
    next: async () => (i < items.length ? { value: items[i++] as T, done: false } : { value: undefined as unknown as T, done: true }),
    close,
  };
}
