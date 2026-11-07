import { expect } from 'chai';
import { MilkiError } from '../src/errors';
import { enrollmentIdFromClientId } from '../src/identity';
import { stableStringify, timestampToIso } from '../src/ledger';
import type { Timestamp } from 'fabric-shim';
import { Harness, ID, PARCEL_ID, expectError, hash } from './support/harness';

describe('Contract surface', () => {
  it('GetContractInfo reports name and version', async () => {
    const h = new Harness();
    expect(await h.call(ID.peerAdmin, 'GetContractInfo')).to.deep.equal({ name: 'land-registry', version: '1.0.0' });
  });

  it('unknown functions fail with a readable NOT_FOUND', async () => {
    const h = new Harness();
    const p = h.ledger.transact(ID.peerAdmin, (ctx) => h.contract.unknownTransaction(ctx), { fcn: 'DeleteParcel' });
    await expectError(p, 'NOT_FOUND', 'Unknown chaincode function: DeleteParcel');
  });

  it('SUPPORT_AGENT and SYSTEM_ADMIN can never write to the ledger', async () => {
    const h = new Harness();
    await h.register();
    const t = await h.initiate();
    const writes: [string, string[]][] = [
      ['RegisterParcel', ['{}']],
      ['UpdateParcel', [PARCEL_ID, '{}']],
      ['FreezeParcel', [PARCEL_ID, 'reason']],
      ['UnfreezeParcel', [PARCEL_ID, 'reason']],
      ['RetireParcel', [PARCEL_ID, 'reason']],
      ['InitiateTransfer', [PARCEL_ID, 'usr_x', hash('x')]],
      ['AcceptTransfer', [t.transferId]],
      ['ConfirmPayments', [t.transferId, 'ref', hash('r')]],
      ['VerifyTransfer', [t.transferId, '']],
      ['ApproveTransfer', [t.transferId, '']],
      ['CancelTransfer', [t.transferId, 'reason']],
      ['RejectTransfer', [t.transferId, 'reason']],
      ['AddEncumbrance', [PARCEL_ID, '{}']],
      ['UpdateEncumbrance', ['ENC-0000000000000000', '{}']],
      ['ReleaseEncumbrance', ['ENC-0000000000000000', 'reason']],
      ['FlagDispute', [PARCEL_ID, '{}']],
      ['AddDisputeNote', ['DSP-0000000000000000', 'note']],
      ['ResolveDispute', ['DSP-0000000000000000', 'resolution']],
      ['AttachDocument', ['{}']],
      ['SupersedeDocument', ['DOC-0000000000000000', hash('x')]],
    ];
    const before = new Map(h.ledger.state);
    for (const who of [ID.support, ID.sysadmin, ID.peerAdmin]) {
      for (const [fn, args] of writes) {
        await expectError(h.call(who, fn, args), 'FORBIDDEN');
      }
    }
    expect(h.ledger.state).to.deep.equal(before);
  });

  it('rejects unknown role attributes', async () => {
    const h = new Harness();
    await expectError(h.call({ mspId: 'Org1MSP', id: 'x1', attrs: { role: 'SUPERUSER' } }, 'FreezeParcel', [PARCEL_ID, 'reason']), 'FORBIDDEN', 'unknown role');
  });

  it('is deterministic: the same transactions on two peers yield byte-identical state', async () => {
    const run = async () => {
      const h = new Harness();
      await h.register();
      await h.addMortgage();
      await h.attach(ID.seller, 'PARCEL', PARCEL_ID, 'TITLE_DEED', 'deed.pdf');
      return h.ledger;
    };
    const [a, b] = [await run(), await run()];
    expect([...a.state.keys()]).to.deep.equal([...b.state.keys()]);
    for (const [k, v] of a.state) expect(Buffer.from(v).equals(Buffer.from(b.state.get(k) ?? new Uint8Array()))).to.equal(true, k);
    expect(a.events).to.deep.equal(b.events);
  });

  it('every write emits milki.<Entity>.<Action> with no personal data', async () => {
    const h = new Harness();
    await h.register();
    await h.transferAt('COMPLETED');
    const enc = await h.addMortgage();
    await h.call(ID.crdb, 'UpdateEncumbrance', [enc.encumbranceId, JSON.stringify({ amount: 1 })]);
    await h.call(ID.crdb, 'ReleaseEncumbrance', [enc.encumbranceId, 'Repaid']);
    for (const ev of h.ledger.events) {
      expect(ev.name).to.match(/^milki\.(Parcel|Transfer|Encumbrance|Dispute|Document)\.[A-Za-z]+$/);
      expect(ev.payload).to.have.keys(['entity', 'action', 'id', 'parcelId', 'status', 'txId', 'timestamp', 'actor', 'data']);
      expect(ev.name).to.equal(`milki.${String(ev.payload.entity)}.${String(ev.payload.action)}`);
      expect(JSON.stringify(ev.payload)).not.to.match(/Nida|salePrice|Contact/i);
    }
  });
});

describe('Helpers', () => {
  it('enrollmentIdFromClientId reads the subject CN, not the issuer CN', () => {
    expect(enrollmentIdFromClientId('x509::/C=US/ST=North Carolina/O=Hyperledger/OU=client/CN=usr_abc::/C=US/O=org1.example.com/CN=ca.org1.example.com')).to.equal('usr_abc');
    expect(() => enrollmentIdFromClientId('garbage')).to.throw(MilkiError);
    expect(() => enrollmentIdFromClientId('x509::/OU=client::/CN=ca')).to.throw(MilkiError);
  });

  it('stableStringify sorts keys at every depth', () => {
    expect(stableStringify({ b: 1, a: { d: [{ z: 1, y: 2 }], c: null } })).to.equal('{"a":{"c":null,"d":[{"y":2,"z":1}]},"b":1}');
  });

  it('timestampToIso handles Long-like and numeric seconds', () => {
    const asLong = { seconds: { toString: () => '1767225600' }, nanos: 5_000_000 } as unknown as Timestamp;
    const asNumber = { seconds: 1767225600, nanos: 0 } as unknown as Timestamp;
    expect(timestampToIso(asLong)).to.equal('2026-01-01T00:00:00.005Z');
    expect(timestampToIso(asNumber)).to.equal('2026-01-01T00:00:00.000Z');
  });

  it('MilkiError carries details on the wire', () => {
    const err = new MilkiError('CONFLICT', 'Dup', { id: 'X' });
    expect(JSON.parse(err.message)).to.deep.equal({ code: 'CONFLICT', message: 'Dup', details: { id: 'X' } });
  });
});
