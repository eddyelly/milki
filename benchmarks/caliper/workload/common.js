'use strict';

const { WorkloadModuleBase } = require('@hyperledger/caliper-core');

const CONTRACT = 'land-registry';
const INVOKER = 'caliper-registrar';

/** Shared helpers: one REGISTRAR identity (role attribute in its certificate) for every round. */
class MilkiWorkload extends WorkloadModuleBase {
  async query(fn, args) {
    return this.sutAdapter.sendRequests({ contractId: CONTRACT, contractFunction: fn, contractArguments: args, readOnly: true, invokerIdentity: INVOKER });
  }

  async invoke(fn, args) {
    return this.sutAdapter.sendRequests({ contractId: CONTRACT, contractFunction: fn, contractArguments: args, readOnly: false, invokerIdentity: INVOKER });
  }

  /** Parcel IDs to read, fetched once per worker with a CouchDB rich query. */
  async loadParcelIds(limit = 100) {
    const res = await this.query('QueryParcels', [JSON.stringify({ selector: { retired: false } }), String(limit), '']);
    const status = Array.isArray(res) ? res[0] : res;
    const raw = status.GetResult ? status.GetResult() : status.result;
    const page = JSON.parse(Buffer.from(raw).toString('utf8'));
    const ids = (page.items ?? page.records ?? []).map((p) => p.parcelId).filter(Boolean);
    if (ids.length === 0) throw new Error('No parcels on the ledger — run "npm run seed:demo" in backend/ first.');
    return ids;
  }

  pick(list) {
    // Benchmark client only (not chaincode): randomness here is fine.
    return list[Math.floor(Math.random() * list.length)];
  }
}

module.exports = { MilkiWorkload };
