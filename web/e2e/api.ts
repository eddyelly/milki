/** Drives the API directly to put the ledger in the state a UI test needs (live network + Mailpit). */
import { randomUUID } from 'node:crypto';

export const API = process.env.API_URL ?? 'http://localhost:4100/api/v1';
export const MAILPIT = process.env.MAILPIT_URL ?? 'http://localhost:8126';
export const PASSWORD = 'Milki@2026';

export const ACCOUNTS = {
  registrar: { email: 'registrar@milki.dev', phone: '+255714000001' },
  officer: { email: 'officer@milki.dev', phone: '+255713000001' },
  seller: { email: 'citizen@milki.dev', phone: '+255712000001' },
  buyer: { email: 'buyer@milki.dev', phone: '+255712000002' },
} as const;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function call<T>(method: string, path: string, token?: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json()) as { data: T; error?: { message: string } };
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${json.error?.message}`);
  return json.data;
}

/** Newest 6-digit code texted to `phone` after `since` (SMS is delivered to Mailpit in dev). */
export async function otpFor(phone: string, since: number): Promise<string> {
  const to = `${phone.replace('+', '')}@sms.milki.local`;
  for (let i = 0; i < 60; i++) {
    const list = (await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}&limit=1`)).json()) as {
      messages: { Created: string; Snippet: string }[];
    };
    const m = list.messages[0];
    if (m && new Date(m.Created).getTime() >= since) {
      const code = /\b(\d{6})\b/.exec(m.Snippet)?.[1];
      if (code) return code;
    }
    await sleep(250);
  }
  throw new Error(`no OTP for ${phone}`);
}

export async function signIn(who: keyof typeof ACCOUNTS): Promise<{ token: string; userId: string }> {
  const acc = ACCOUNTS[who];
  const since = Date.now() - 1000;
  const ch = await call<{ challengeId: string }>('POST', '/auth/login', undefined, { identifier: acc.email, password: PASSWORD });
  const s = await call<{ accessToken: string; user: { userId: string } }>('POST', '/auth/otp/verify', undefined, { challengeId: ch.challengeId, code: await otpFor(acc.phone, since) });
  return { token: s.accessToken, userId: s.user.userId };
}

async function t3<T>(token: string, path: string, body: unknown): Promise<T> {
  const { reauthToken } = await call<{ reauthToken: string }>('POST', '/auth/reauth', token, { password: PASSWORD });
  return call<T>('POST', path, token, body, { 'idempotency-key': `e2e-${randomUUID()}`, 'x-reauth-token': reauthToken });
}

async function committed(token: string, txId: string): Promise<void> {
  for (let i = 0; i < 160; i++) {
    const s = await call<{ status: string }>('GET', `/ledger/tx/${txId}`, token);
    if (s.status === 'COMMITTED') return;
    if (s.status === 'FAILED') throw new Error(`tx ${txId} failed`);
    await sleep(250);
  }
  throw new Error(`tx ${txId} not committed`);
}

async function upload(token: string, transferId: string): Promise<string> {
  const { reauthToken } = await call<{ reauthToken: string }>('POST', '/auth/reauth', token, { password: PASSWORD });
  const form = new FormData();
  form.append('targetType', 'TRANSFER');
  form.append('targetId', transferId);
  form.append('documentType', 'TAX_RECEIPT');
  form.append('file', new Blob([`%PDF-1.7\nTRA receipt ${transferId} ${Date.now()}`], { type: 'application/pdf' }), 'tra-receipt.pdf');
  const res = await fetch(`${API}/documents`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'idempotency-key': `e2e-${randomUUID()}`, 'x-reauth-token': reauthToken },
    body: form,
  });
  const json = (await res.json()) as { data: { txId: string; documentId: string } };
  await committed(token, json.data.txId);
  return json.data.documentId;
}

/** Registers a fresh parcel for the seller and walks a transfer to BUYER_ACCEPTED with a receipt attached (the mobile part). */
export async function prepareAcceptedTransfer(): Promise<{ parcelId: string; transferId: string; buyerId: string }> {
  const rnd = () => Math.floor(100 + Math.random() * 899);
  const parcelId = `DSM-UBG-${rnd()}-${rnd()}`;
  const registrar = await signIn('registrar');
  const seller = await signIn('seller');
  const buyer = await signIn('buyer');
  const reg = await t3<{ txId: string }>(registrar.token, '/parcels', {
    parcelId,
    titleNumber: `E2E/${parcelId}`,
    region: 'Dar es Salaam',
    district: 'Ubungo',
    ward: 'Sinza',
    blockNumber: '7',
    plotNumber: '21',
    area: 610,
    landUse: 'RESIDENTIAL',
    location: { latitude: -6.7735, longitude: 39.2265 },
    owner: { userId: seller.userId },
  });
  await committed(registrar.token, reg.txId);
  const init = await t3<{ txId: string; transferId: string }>(seller.token, '/transfers', { parcelId, buyer: { userId: buyer.userId }, salePrice: 98_500_000 });
  await committed(seller.token, init.txId);
  const acc = await t3<{ txId: string }>(buyer.token, `/transfers/${init.transferId}/accept`, {});
  await committed(buyer.token, acc.txId);
  await upload(buyer.token, init.transferId);
  return { parcelId, transferId: init.transferId, buyerId: buyer.userId };
}

/** Public QR verification (no sign-in). */
export async function publicVerify(parcelId: string): Promise<{ owner: string; status: string; ownershipVersion: number }> {
  const res = await fetch(`${API}/verify/parcels/${parcelId}`);
  return ((await res.json()) as { data: { owner: string; status: string; ownershipVersion: number } }).data;
}

/** Registers a fresh parcel and walks a transfer to OFFICER_VERIFIED, ready for a registrar to approve. */
export async function prepareVerifiedTransfer(): Promise<{ parcelId: string; transferId: string }> {
  const rnd = () => Math.floor(100 + Math.random() * 899);
  const parcelId = `DSM-UBG-${rnd()}-${rnd()}`;
  const registrar = await signIn('registrar');
  const seller = await signIn('seller');
  const buyer = await signIn('buyer');
  const officer = await signIn('officer');

  const reg = await t3<{ txId: string }>(registrar.token, '/parcels', {
    parcelId,
    titleNumber: `E2E/${parcelId}`,
    region: 'Dar es Salaam',
    district: 'Ubungo',
    ward: 'Sinza',
    blockNumber: '4',
    plotNumber: '9',
    area: 525,
    landUse: 'RESIDENTIAL',
    location: { latitude: -6.7735, longitude: 39.2265 },
    owner: { userId: seller.userId },
  });
  await committed(registrar.token, reg.txId);

  const init = await t3<{ txId: string; transferId: string }>(seller.token, '/transfers', { parcelId, buyer: { userId: buyer.userId }, salePrice: 142_000_000 });
  await committed(seller.token, init.txId);
  const acc = await t3<{ txId: string }>(buyer.token, `/transfers/${init.transferId}/accept`, {});
  await committed(buyer.token, acc.txId);
  const receipt = await upload(buyer.token, init.transferId);
  const conf = await t3<{ txId: string }>(officer.token, `/transfers/${init.transferId}/confirm-payments`, { paymentReference: 'TRA-E2E-0001', evidenceDocumentId: receipt });
  await committed(officer.token, conf.txId);
  const ver = await t3<{ txId: string }>(officer.token, `/transfers/${init.transferId}/verify`, { note: 'E2E verification' });
  await committed(officer.token, ver.txId);
  return { parcelId, transferId: init.transferId };
}
