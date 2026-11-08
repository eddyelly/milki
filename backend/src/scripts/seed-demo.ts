/**
 * DEV ONLY (CLAUDE.md §13 phase 10): demo data on the live network — 3 regions with land offices, 30 parcels,
 * transfers in every state, a bank mortgage and a dispute. Run `npm run seed` first (accounts), then:
 *
 *   npm run seed:demo
 *
 * Idempotent: parcels that already exist are skipped, and a transfer scenario only runs on a parcel with no
 * transfer history. Every ledger step waits for its commit before the next one.
 */
import { env } from '../config/env';
import type { AuthUser } from '../core/auth';
import { piiHash, seal } from '../core/crypto';
import { connectDatastores, disconnectDatastores } from '../core/datastores';
import { closeGatewayPool, initGatewayPool } from '../core/fabric/gateway';
import { ledger } from '../core/fabric/ledger';
import { LedgerTx } from '../core/fabric/ledger-tx.model';
import { logger } from '../core/logger';
import type { Role } from '../core/roles';
import { LandOffice } from '../modules/admin/office.model';
import { hashPassword } from '../modules/auth/auth.service';
import { upload } from '../modules/documents/document.service';
import { addEncumbrance } from '../modules/encumbrances/encumbrance.service';
import { register } from '../modules/parcels/parcel.service';
import { act, confirmPayments, initiate } from '../modules/transfers/transfer.service';
import { User } from '../modules/users/user.model';
import { ensureLedgerIdentity, newUserId } from '../modules/users/user.service';

if (env.NODE_ENV === 'production') throw new Error('Refusing to seed demo data in production.');
if (!env.FABRIC_ENABLED) throw new Error('seed:demo writes to the ledger: start the network and set FABRIC_ENABLED=true.');

// Same dev password as `npm run seed` (not imported: that module runs its own main()).
const DEMO_PASSWORD = 'Milki@2026';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Waits until the ledger commits `txId` (the submit's commit listener updates ledger_transactions). */
async function committed(txId: string): Promise<void> {
  for (let i = 0; i < 240; i++) {
    const t = await LedgerTx.findOne({ txId }, { status: 1 }).lean();
    if (t?.status === 'COMMITTED') return;
    if (t?.status === 'FAILED') throw new Error(`transaction ${txId} failed validation`);
    await sleep(500);
  }
  throw new Error(`timed out waiting for ${txId}`);
}

const EXTRA_CITIZENS = [
  { fullName: 'Neema Joseph', phone: '+255712000003', email: 'neema@milki.dev', nida: '19930303123450000303' },
  { fullName: 'Baraka Kimaro', phone: '+255712000004', email: 'baraka@milki.dev', nida: '19850404123450000404' },
  { fullName: 'Zawadi Mollel', phone: '+255712000005', email: 'zawadi@milki.dev', nida: '19960505123450000505' },
  { fullName: 'Rehema Salim', phone: '+255712000006', email: 'rehema@milki.dev', nida: '19880606123450000606' },
];

const OFFICES = [
  { code: 'DSM-KIN', name: 'Kinondoni District Land Office', region: 'Dar es Salaam', district: 'Kinondoni', address: 'Morogoro Road, Magomeni', phone: '+255222170000' },
  { code: 'ARU-ARS', name: 'Arusha City Land Office', region: 'Arusha', district: 'Arusha City', address: 'Boma Road', phone: '+255272500000' },
  { code: 'MWZ-ILE', name: 'Ilemela Municipal Land Office', region: 'Mwanza', district: 'Ilemela', address: 'Buswelu', phone: '+255282540000' },
];

interface Area {
  prefix: string;
  region: string;
  district: string;
  wards: string[];
  lat: number;
  lng: number;
}
const AREAS: Area[] = [
  { prefix: 'DSM-KIN', region: 'Dar es Salaam', district: 'Kinondoni', wards: ['Mikocheni', 'Msasani', 'Kawe', 'Sinza', 'Mbezi'], lat: -6.7563, lng: 39.2523 },
  { prefix: 'ARU-ARS', region: 'Arusha', district: 'Arusha City', wards: ['Kijenge', 'Sekei', 'Njiro', 'Themi', 'Olorieni'], lat: -3.3869, lng: 36.683 },
  { prefix: 'MWZ-ILE', region: 'Mwanza', district: 'Ilemela', wards: ['Buswelu', 'Kirumba', 'Nyamanoro', 'Pasiansi', 'Kitangiri'], lat: -2.4947, lng: 32.9302 },
];
const USES = ['RESIDENTIAL', 'RESIDENTIAL', 'RESIDENTIAL', 'COMMERCIAL', 'AGRICULTURAL', 'MIXED_USE', 'INSTITUTIONAL', 'RESIDENTIAL', 'COMMERCIAL', 'RESIDENTIAL'] as const;

/** Deterministic pseudo-random numbers so re-runs produce the same parcels. */
function rng(seed: number) {
  let x = seed;
  return () => {
    x = (x * 1103515245 + 12345) % 2 ** 31;
    return x / 2 ** 31;
  };
}

function square(lat: number, lng: number, sizeM: number): [number, number][] {
  const d = sizeM / 111_000 / 2;
  return [
    [lng - d, lat - d],
    [lng + d, lat - d],
    [lng + d, lat + d],
    [lng - d, lat + d],
  ];
}

/**
 * The full demo parcel plan, computed up front so every run draws the same random numbers in the same order
 * (skipping an existing parcel must not shift the sequence for the next one).
 */
export function demoParcels() {
  const out = [];
  for (const [ai, a] of AREAS.entries()) {
    const r = rng(ai + 7);
    for (let i = 0; i < 10; i++) {
      const block = 10 + Math.floor(r() * 40);
      const plot = 100 + i * 7 + Math.floor(r() * 5);
      const lat = a.lat + (r() - 0.5) * 0.06;
      const lng = a.lng + (r() - 0.5) * 0.06;
      const landUse = USES[i]!;
      const area = landUse === 'AGRICULTURAL' ? Math.round(8000 + r() * 40000) : Math.round(300 + r() * 1500);
      const ward = a.wards[i % a.wards.length]!;
      out.push({
        parcelId: `${a.prefix}-${block}-${plot}`,
        titleNumber: `CT/${a.prefix}/${block}/${plot}`,
        region: a.region,
        district: a.district,
        ward,
        blockNumber: String(block),
        plotNumber: String(plot),
        area,
        landUse,
        location: { latitude: Number(lat.toFixed(6)), longitude: Number(lng.toFixed(6)), boundary: square(lat, lng, Math.sqrt(area)), address: `${ward}, ${a.district}` },
        ownerIndex: i,
      });
    }
  }
  return out;
}

const PDF = (text: string) => Buffer.from(`%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n% ${text}\ntrailer << /Root 1 0 R >>\n%%EOF\n`);

async function main(): Promise<void> {
  await connectDatastores();
  initGatewayPool();
  const passwordHash = await hashPassword(DEMO_PASSWORD);

  // ---------------------------------------------------------------------------------- people & offices
  for (const c of EXTRA_CITIZENS) {
    const u = (await User.findOne({ phone: c.phone })) ?? new User({ userId: newUserId(), phone: c.phone });
    u.set({ role: 'CITIZEN', fullName: c.fullName, email: c.email, passwordHash, status: 'ACTIVE', deletedAt: null, nidaHash: piiHash(c.nida), nidaSealed: seal(c.nida, 'milki-nida'), nidaLast4: c.nida.slice(-4) });
    await u.save();
    await ensureLedgerIdentity(u);
  }
  for (const o of OFFICES) await LandOffice.updateOne({ code: o.code }, { $set: { ...o, deletedAt: null } }, { upsert: true });
  const kin = await LandOffice.findOne({ code: 'DSM-KIN' }).lean();
  await User.updateMany({ email: { $in: ['officer@milki.dev', 'registrar@milki.dev'] } }, { officeId: String(kin!._id) });

  const byEmail = async (email: string): Promise<AuthUser & { name: string }> => {
    const u = await User.findOne({ email }).lean();
    if (!u) throw new Error(`${email} is missing — run "npm run seed" first.`);
    return { userId: u.userId, role: u.role as Role, name: u.fullName };
  };
  const [asha, juma, neema, baraka, zawadi, rehema] = await Promise.all(
    ['citizen@milki.dev', 'buyer@milki.dev', 'neema@milki.dev', 'baraka@milki.dev', 'zawadi@milki.dev', 'rehema@milki.dev'].map(byEmail),
  );
  const registrar = await byEmail('registrar@milki.dev');
  const officer = await byEmail('officer@milki.dev');
  const bank = await byEmail('bank@milki.dev');
  const owners = [asha!, asha!, juma!, neema!, baraka!, zawadi!, rehema!, asha!, neema!, juma!];

  // ------------------------------------------------------------------------------------------ parcels
  let created = 0;
  const plan = demoParcels();
  const ids = plan.map((p) => p.parcelId);
  for (const p of plan) {
    const exists = await ledger.evaluate('service', 'GetParcel', [p.parcelId]).then(
      () => true,
      () => false,
    );
    if (exists) continue;
    const { ownerIndex, ...body } = p;
    const res = await register(registrar, { ...body, owner: { userId: owners[ownerIndex]!.userId } });
    await committed(res.txId);
    created++;
    logger.info({ parcelId: p.parcelId, owner: owners[p.ownerIndex]!.name }, 'parcel registered');
  }

  // ---------------------------------------------------------------------------------------- scenarios
  const fresh = async (parcelId: string) => {
    const p = await ledger.evaluate<{ status: string }>('service', 'GetParcel', [parcelId]);
    const t = await ledger.evaluate<unknown[]>('service', 'GetParcelTransfers', [parcelId]);
    return p.status === 'ACTIVE' && t.length === 0;
  };
  const step = async <T extends { txId: string }>(label: string, fn: () => Promise<T>): Promise<T> => {
    const r = await fn();
    await committed(r.txId);
    logger.info({ txId: r.txId }, label);
    return r;
  };

  /** Seller → buyer, advanced to `until`. */
  async function transfer(parcelId: string, seller: AuthUser, buyer: AuthUser, price: number, until: 'INITIATED' | 'BUYER_ACCEPTED' | 'PAYMENTS_CONFIRMED' | 'OFFICER_VERIFIED' | 'COMPLETED' | 'CANCELLED') {
    if (!(await fresh(parcelId))) return logger.info({ parcelId }, 'transfer scenario already present — skipped');
    const t = await step(`${parcelId}: initiated`, () => initiate(seller, { parcelId, buyer: { userId: buyer.userId }, salePrice: price, currency: 'TZS' }));
    if (until === 'INITIATED') return;
    if (until === 'CANCELLED') {
      await step(`${parcelId}: cancelled`, () => act(seller, t.transferId, 'CancelTransfer', 'Buyer could not raise the funds'));
      return;
    }
    await step(`${parcelId}: accepted`, () => act(buyer, t.transferId, 'AcceptTransfer'));
    if (until === 'BUYER_ACCEPTED') return;
    const doc = await upload(buyer, { buffer: PDF(`TRA receipt for ${t.transferId}`), mimetype: 'application/pdf', originalname: 'tra-receipt.pdf', size: 120 }, { targetType: 'TRANSFER', targetId: t.transferId, documentType: 'PAYMENT_PROOF' });
    await committed(doc.txId);
    await step(`${parcelId}: payments confirmed`, () => confirmPayments(officer, t.transferId, { paymentReference: `TRA-${t.transferId.slice(4, 12)}`, evidenceDocumentId: doc.documentId }));
    if (until === 'PAYMENTS_CONFIRMED') return;
    await step(`${parcelId}: verified`, () => act(officer, t.transferId, 'VerifyTransfer', 'Site visit done; boundaries match the survey plan.'));
    if (until === 'OFFICER_VERIFIED') return;
    await step(`${parcelId}: approved & completed`, () => act(registrar, t.transferId, 'ApproveTransfer', 'Approved.'));
  }

  const [d, a, m] = [ids.slice(0, 10), ids.slice(10, 20), ids.slice(20, 30)];
  await transfer(d[0]!, asha!, juma!, 85_000_000, 'INITIATED');
  await transfer(d[3]!, neema!, asha!, 142_000_000, 'BUYER_ACCEPTED');
  await transfer(d[4]!, baraka!, zawadi!, 64_500_000, 'PAYMENTS_CONFIRMED');
  await transfer(a[5]!, zawadi!, rehema!, 210_000_000, 'OFFICER_VERIFIED');
  await transfer(a[6]!, rehema!, juma!, 98_000_000, 'COMPLETED');
  await transfer(m[7]!, asha!, neema!, 55_000_000, 'CANCELLED');

  // Bank mortgage on an Arusha parcel; dispute on a Mwanza parcel.
  const mortgaged = a[2]!;
  if ((await ledger.evaluate<unknown[]>('service', 'GetEncumbrances', [mortgaged])).length === 0) {
    const bankUser = await User.findOne({ userId: bank.userId }).lean();
    await step(`${mortgaged}: CRDB mortgage`, () =>
      addEncumbrance({ ...bank, bankCode: bankUser?.bankCode }, bankUser?.bankName ?? 'CRDB Bank', mortgaged, { type: 'MORTGAGE', amount: 120_000_000, currency: 'TZS', reference: 'CRDB/HL/2026/0042' }),
    );
  }
  const disputed = m[4]!;
  if ((await ledger.evaluate<unknown[]>('service', 'GetDisputes', [disputed])).length === 0) {
    await step(`${disputed}: dispute flagged`, () =>
      ledger.submit({ ...officer }, 'FlagDispute', [disputed, JSON.stringify({ category: 'BOUNDARY', summary: 'Neighbour claims the eastern boundary encroaches 4 m onto plot 118.' })], { entityType: 'Dispute', entityId: disputed }),
    );
  }

  closeGatewayPool();
  await disconnectDatastores();
  // eslint-disable-next-line no-console
  console.log(`\nDemo data ready: ${created} new parcels (${ids.length} in the demo set), transfers in every state, a mortgage and a dispute.\nThe API's event listener fills the caches when it is running.\n`);
  process.exit(0);
}

main().catch((err: unknown) => {
  logger.fatal({ err }, 'demo seed failed');
  process.exit(1);
});
