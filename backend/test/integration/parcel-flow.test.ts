/**
 * Full-stack check against the RUNNING API (npm run dev), the live Fabric network and Mailpit.
 * Prerequisites: infra up, network up with chaincode, `npm run seed`, API listening on :4100.
 *
 *   npm run test:integration
 */
import { randomUUID } from 'node:crypto';
import { io, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const API = process.env.API_URL ?? 'http://localhost:4100/api/v1';
const MAILPIT = process.env.MAILPIT_URL ?? 'http://localhost:8126';
const PASSWORD = 'Milki@2026';

interface Envelope<T> {
  data: T;
  meta: Record<string, unknown> | null;
  error?: { code: string; message: string };
}

async function call<T>(method: string, path: string, opts: { token?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      ...opts.headers,
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  return { status: res.status, body: (await res.json()) as Envelope<T> };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Reads the newest SMS-to-email for a phone from Mailpit and extracts the 6-digit code. */
async function otpFor(phone: string, after: number): Promise<string> {
  const to = `${phone.replace('+', '')}@sms.milki.local`;
  for (let i = 0; i < 40; i++) {
    const list = (await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}&limit=1`)).json()) as {
      messages: { ID: string; Created: string; Snippet: string }[];
    };
    const m = list.messages[0];
    if (m && new Date(m.Created).getTime() >= after) {
      const code = m.Snippet.match(/\b(\d{6})\b/)?.[1];
      if (code) return code;
    }
    await sleep(250);
  }
  throw new Error(`no OTP for ${phone}`);
}

async function signIn(identifier: string, phone: string) {
  const t0 = Date.now() - 1000;
  const step1 = await call<{ challengeId: string }>('POST', '/auth/login', { body: { identifier, password: PASSWORD } });
  expect(step1.status).toBe(200);
  const step2 = await call<{ accessToken: string; user: { userId: string; role: string } }>('POST', '/auth/otp/verify', {
    body: { challengeId: step1.body.data.challengeId, code: await otpFor(phone, t0) },
  });
  expect(step2.status).toBe(200);
  return step2.body.data;
}

async function reauth(token: string): Promise<string> {
  const r = await call<{ reauthToken: string }>('POST', '/auth/reauth', { token, body: { password: PASSWORD } });
  expect(r.status).toBe(200);
  return r.body.data.reauthToken;
}

async function t3(method: string, path: string, token: string, body: unknown) {
  return call<{ txId: string; status: string }>(method, path, {
    token,
    body,
    headers: { 'idempotency-key': `it-${randomUUID()}`, 'x-reauth-token': await reauth(token) },
  });
}

describe('parcel lifecycle through the API on the live network', () => {
  let registrar: { accessToken: string; user: { userId: string } };
  let citizen: { accessToken: string; user: { userId: string } };
  let socket: Socket;
  const commits = new Map<string, { status: string; blockNumber: number }>();
  const parcelId = `DSM-ILA-${Math.floor(100 + Math.random() * 899)}-${Math.floor(100 + Math.random() * 899)}`;

  beforeAll(async () => {
    registrar = await signIn('registrar@milki.dev', '+255714000001');
    citizen = await signIn('citizen@milki.dev', '+255712000001');
    socket = io(API.replace('/api/v1', ''), { auth: { token: registrar.accessToken }, transports: ['websocket'] });
    socket.on('ledger:tx', (e: { txId: string; status: string; blockNumber: number }) => commits.set(e.txId, e));
    await new Promise<void>((resolve, reject) => {
      socket.on('connect', () => resolve());
      socket.on('connect_error', reject);
    });
  });

  afterAll(() => {
    socket?.close();
  });

  async function committed(txId: string) {
    for (let i = 0; i < 80 && !commits.has(txId); i++) await sleep(250);
    const viaSocket = commits.get(txId);
    expect(viaSocket, 'ledger:tx socket event').toBeDefined();
    expect(viaSocket?.status).toBe('COMMITTED');
    const polled = await call<{ status: string; blockNumber: number }>('GET', `/ledger/tx/${txId}`, { token: registrar.accessToken });
    expect(polled.body.data).toMatchObject({ status: 'COMMITTED', blockNumber: viaSocket?.blockNumber });
  }

  it('registrar registers a parcel for the citizen (202 → committed over Socket.IO)', async () => {
    const res = await t3('POST', '/parcels', registrar.accessToken, {
      parcelId,
      titleNumber: `IT/${parcelId}`,
      region: 'Dar es Salaam',
      district: 'Ilala',
      ward: 'Upanga',
      blockNumber: '7',
      plotNumber: '21',
      area: 812.25,
      landUse: 'COMMERCIAL',
      location: { latitude: -6.8123, longitude: 39.2876, address: 'Upanga West' },
      owner: { userId: citizen.user.userId },
    });
    expect(res.status).toBe(202);
    expect(res.body.data.status).toBe('SUBMITTED');
    await committed(res.body.data.txId);
  });

  it('the parcel reads back from the ledger, and the owner can see it', async () => {
    const asOfficial = await call<{ owner: { userId: string; fullName: string }; status: string }>('GET', `/parcels/${parcelId}`, { token: registrar.accessToken });
    expect(asOfficial.body.meta).toEqual({ source: 'ledger' });
    expect(asOfficial.body.data).toMatchObject({ status: 'ACTIVE', owner: { userId: citizen.user.userId, fullName: 'Asha Mwakyusa' } });
    const asOwner = await call<{ owner: { userId: string } }>('GET', `/parcels/${parcelId}`, { token: citizen.accessToken });
    expect(asOwner.status).toBe(200);
  });

  it('the event listener fills the cache, so the owner sees it in their list', async () => {
    for (let i = 0; i < 40; i++) {
      const list = await call<{ parcelId: string }[]>('GET', `/parcels?q=${parcelId}`, { token: citizen.accessToken });
      if (list.body.data.length === 1) return;
      await sleep(250);
    }
    throw new Error('parcel never reached the cache');
  });

  it('chaincode guards come back as readable errors', async () => {
    const dup = await t3('POST', '/parcels', registrar.accessToken, {
      parcelId,
      titleNumber: `IT2/${parcelId}`,
      region: 'Dar es Salaam',
      district: 'Ilala',
      ward: 'Upanga',
      blockNumber: '7',
      plotNumber: '21',
      area: 812.25,
      landUse: 'COMMERCIAL',
      location: { latitude: -6.8123, longitude: 39.2876 },
      owner: { userId: citizen.user.userId },
    });
    expect(dup.status).toBe(409);
    expect(dup.body.error).toMatchObject({ code: 'CONFLICT', message: `Parcel ${parcelId} is already registered.` });
  });

  it('freeze → FROZEN → unfreeze → ACTIVE, recorded in the history chain', async () => {
    const f = await t3('POST', `/parcels/${parcelId}/freeze`, registrar.accessToken, { reason: 'Court order 77/2026' });
    expect(f.status).toBe(202);
    await committed(f.body.data.txId);
    expect((await call<{ status: string }>('GET', `/parcels/${parcelId}`, { token: registrar.accessToken })).body.data.status).toBe('FROZEN');

    const again = await t3('POST', `/parcels/${parcelId}/freeze`, registrar.accessToken, { reason: 'Again' });
    expect(again.status).toBe(409);
    expect(again.body.error?.message).toBe(`Parcel ${parcelId} is already frozen.`);

    const u = await t3('POST', `/parcels/${parcelId}/unfreeze`, registrar.accessToken, { reason: 'Order lifted' });
    await committed(u.body.data.txId);
    const hist = await call<{ status: string; note: string | null }[]>('GET', `/parcels/${parcelId}/history`, { token: registrar.accessToken });
    expect(hist.body.data.map((h) => h.status)).toEqual(['ACTIVE', 'FROZEN', 'ACTIVE']);
    expect(hist.body.data.at(-1)?.note).toBe('Order lifted');
  });

  it('citizens cannot write to the ledger even with a valid re-auth', async () => {
    const res = await t3('POST', `/parcels/${parcelId}/freeze`, citizen.accessToken, { reason: 'I want to' });
    expect(res.status).toBe(403);
  });
});
