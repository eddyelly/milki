import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, vi } from 'vitest';

import { outbox } from './outbox';

vi.mock('../src/core/notify', async () => {
  const { outbox: box } = await import('./outbox');
  return {
  notify: {
    sms: async (to: string, text: string) => {
      box.push({ kind: 'sms', to, text });
    },
    email: async (to: string, _subject: string, text: string) => {
      box.push({ kind: 'email', to, text });
    },
  },
  startEmailWorker: () => undefined,
  stopEmailWorker: async () => undefined,
  };
});

/** Fabric is mocked in unit tests (CLAUDE.md §14); each test programs ledger.evaluate / ledger.submit. */
vi.mock('../src/core/fabric/ledger', async () => {
  const actual = await vi.importActual<typeof import('../src/core/fabric/ledger')>('../src/core/fabric/ledger');
  const evaluate = vi.fn();
  const submit = vi.fn();
  return { ...actual, evaluate, submit, ledger: { evaluate, submit } };
});

vi.mock('../src/core/fabric/wallet', () => ({
  userIdentity: vi.fn(async (u: { userId: string }) => ({ label: u.userId, org: 'org1', mspId: 'Org1MSP', certificate: 'CERT', privateKeyPem: 'KEY' })),
  serviceIdentity: vi.fn(async () => ({ label: 'svc', org: 'org1', mspId: 'Org1MSP', certificate: 'CERT', privateKeyPem: 'KEY' })),
  forgetIdentity: vi.fn(async () => undefined),
}));

const { connectDatastores, disconnectDatastores, redis } = await import('../src/core/datastores');

beforeAll(async () => {
  await connectDatastores();
});

beforeEach(async () => {
  outbox.length = 0;
  vi.clearAllMocks();
  const db = mongoose.connection.db;
  if (db) await Promise.all((await db.collections()).map((c) => c.deleteMany({})));
  await redis.flushdb();
});

afterAll(async () => {
  await disconnectDatastores();
});
