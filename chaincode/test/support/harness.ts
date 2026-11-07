import { createHash } from 'node:crypto';
import { expect } from 'chai';
import { MilkiError, type ErrorCode } from '../../src/errors';
import { LandRegistryContract } from '../../src/landRegistry.contract';
import type { Dispute, DocumentRef, Encumbrance, Parcel, Transfer } from '../../src/models';
import { FakeLedger, type FakeIdentity } from './fake-ledger';

export const hash = (s: string): string => createHash('sha256').update(s).digest('hex');

const org1 = (id: string, role: string): FakeIdentity => ({ mspId: 'Org1MSP', id, attrs: { role } });

export const ID = {
  registrar: org1('registrar1', 'REGISTRAR'),
  registrar2: org1('registrar2', 'REGISTRAR'),
  seller: org1('usr_seller', 'CITIZEN'),
  buyer: org1('usr_buyer', 'CITIZEN'),
  stranger: org1('usr_stranger', 'CITIZEN'),
  support: org1('support1', 'SUPPORT_AGENT'),
  sysadmin: org1('admin1', 'SYSTEM_ADMIN'),
  officer: { mspId: 'Org2MSP', id: 'officer1', attrs: { role: 'LAND_OFFICER' } },
  officer2: { mspId: 'Org2MSP', id: 'officer2', attrs: { role: 'LAND_OFFICER' } },
  crdb: { mspId: 'Org3MSP', id: 'bank_crdb_1', attrs: { role: 'BANK_OFFICER', bank: 'CRDB' } },
  nmb: { mspId: 'Org3MSP', id: 'bank_nmb_1', attrs: { role: 'BANK_OFFICER', bank: 'NMB' } },
  bankNoCode: { mspId: 'Org3MSP', id: 'bank_x', attrs: { role: 'BANK_OFFICER' } },
  peerAdmin: { mspId: 'Org1MSP', id: 'Admin@org1.example.com', attrs: {} },
  /** A REGISTRAR certificate issued by the bank CA — must be rejected. */
  forgedRegistrar: { mspId: 'Org3MSP', id: 'mallory', attrs: { role: 'REGISTRAR' } },
} satisfies Record<string, FakeIdentity>;

export const PARCEL_ID = 'DSM-KIN-12-45';
export const SELLER_NIDA = hash('salt:19900101-00001-00001-01');
export const BUYER_NIDA = hash('salt:19920202-00002-00002-02');

export const parcelInput = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  parcelId: PARCEL_ID,
  titleNumber: 'DSM/KIN/2026/0045',
  region: 'Dar es Salaam',
  district: 'Kinondoni',
  ward: 'Mikocheni',
  blockNumber: '12',
  plotNumber: '45',
  area: 650.5,
  landUse: 'RESIDENTIAL',
  location: { latitude: -6.7631, longitude: 39.2462, boundary: null, address: 'Plot 45, Block 12, Mikocheni' },
  ownerId: ID.seller.id,
  ownerNidaHash: SELLER_NIDA,
  ...overrides,
});

export const privateSale = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  salePrice: 185_000_000,
  currency: 'TZS',
  sellerNidaRef: 'NIDA-REF-SELLER-0001',
  buyerNidaRef: 'NIDA-REF-BUYER-0002',
  sellerContactHash: hash('salt:+255700000001'),
  buyerContactHash: hash('salt:+255700000002'),
  ...overrides,
});

type ContractFn = (ctx: unknown, ...args: string[]) => Promise<string>;

/** Calls contract functions by name, as a given identity, each call one committed transaction. */
export class Harness {
  readonly ledger = new FakeLedger();
  readonly contract = new LandRegistryContract();

  async call<T = unknown>(identity: FakeIdentity, fn: string, args: string[] = [], transient?: Record<string, unknown>): Promise<T> {
    const method = (this.contract as unknown as Record<string, ContractFn>)[fn];
    if (typeof method !== 'function') throw new Error(`No contract function ${fn}`);
    const raw = await this.ledger.transact(identity, (ctx) => method.call(this.contract, ctx, ...args), transient ? { transient } : {});
    return JSON.parse(raw) as T;
  }

  // ---- convenience wrappers -------------------------------------------------------------
  register(overrides: Record<string, unknown> = {}): Promise<Parcel> {
    return this.call<Parcel>(ID.registrar, 'RegisterParcel', [JSON.stringify(parcelInput(overrides))]);
  }

  parcel(id = PARCEL_ID): Parcel {
    const p = this.ledger.json<Parcel>(`PARCEL_${id}`);
    if (!p) throw new Error(`parcel ${id} missing`);
    return p;
  }

  transfer(id: string): Transfer {
    const t = this.ledger.json<Transfer>(`TRANSFER_${id}`);
    if (!t) throw new Error(`transfer ${id} missing`);
    return t;
  }

  initiate(parcelId = PARCEL_ID, buyer = ID.buyer.id, buyerNida = BUYER_NIDA, sale = privateSale()): Promise<Transfer> {
    return this.call<Transfer>(ID.seller, 'InitiateTransfer', [parcelId, buyer, buyerNida], { transfer: sale });
  }

  accept(id: string): Promise<Transfer> {
    return this.call<Transfer>(ID.buyer, 'AcceptTransfer', [id]);
  }

  confirm(id: string): Promise<Transfer> {
    return this.call<Transfer>(ID.officer, 'ConfirmPayments', [id, 'TRA-2026-000981', hash('receipt.pdf')]);
  }

  verify(id: string): Promise<Transfer> {
    return this.call<Transfer>(ID.officer, 'VerifyTransfer', [id, 'Documents and payments checked']);
  }

  approve(id: string, who = ID.registrar): Promise<Transfer> {
    return this.call<Transfer>(who, 'ApproveTransfer', [id, 'Approved']);
  }

  /** Drives a transfer to the given status. */
  async transferAt(status: Transfer['status']): Promise<Transfer> {
    let t = await this.initiate();
    const steps: [Transfer['status'], (id: string) => Promise<Transfer>][] = [
      ['BUYER_ACCEPTED', (id) => this.accept(id)],
      ['PAYMENTS_CONFIRMED', (id) => this.confirm(id)],
      ['OFFICER_VERIFIED', (id) => this.verify(id)],
      ['COMPLETED', (id) => this.approve(id)],
    ];
    for (const [s, run] of steps) {
      if (t.status === status) break;
      t = await run(t.transferId);
      if (s === status) break;
    }
    expect(t.status).to.equal(status);
    return t;
  }

  addMortgage(who: FakeIdentity = ID.crdb, parcelId = PARCEL_ID, overrides: Record<string, unknown> = {}): Promise<Encumbrance> {
    return this.call<Encumbrance>(who, 'AddEncumbrance', [
      parcelId,
      JSON.stringify({ type: 'MORTGAGE', lenderName: who === ID.nmb ? 'NMB Bank' : 'CRDB Bank', amount: 90_000_000, currency: 'TZS', reference: 'LN-2026-77', ...overrides }),
    ]);
  }

  flagDispute(parcelId = PARCEL_ID): Promise<Dispute> {
    return this.call<Dispute>(ID.officer, 'FlagDispute', [
      parcelId,
      JSON.stringify({ category: 'BOUNDARY', summary: 'Neighbour contests the eastern boundary beacon.' }),
    ]);
  }

  attach(who: FakeIdentity, targetType: string, targetId: string, documentType: string, content: string): Promise<DocumentRef> {
    return this.call<DocumentRef>(who, 'AttachDocument', [JSON.stringify({ targetType, targetId, documentType, sha256: hash(content) })]);
  }
}

/** Asserts that `promise` rejects with a MilkiError of `code` (and optionally a message fragment). */
export async function expectError(promise: Promise<unknown>, code: ErrorCode, messagePart?: string): Promise<MilkiError> {
  let caught: unknown;
  try {
    await promise;
  } catch (err) {
    caught = err;
  }
  expect(caught, `expected ${code} error`).to.be.instanceOf(MilkiError);
  const err = caught as MilkiError;
  expect(err.code, err.humanMessage).to.equal(code);
  if (messagePart) expect(err.humanMessage).to.include(messagePart);
  // The wire format the backend parses.
  const wire = JSON.parse(err.message) as { code: string; message: string };
  expect(wire.code).to.equal(code);
  expect(wire.message).to.equal(err.humanMessage);
  return err;
}
