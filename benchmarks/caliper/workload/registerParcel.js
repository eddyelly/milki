'use strict';

const crypto = require('crypto');
const { MilkiWorkload } = require('./common');

const letters = (n) => Array.from({ length: n }, () => String.fromCharCode(65 + crypto.randomInt(26))).join('');

/**
 * Ledger write endorsed by Org1 + (Org2 or Org3), ordered by Raft and committed with a CouchDB update.
 * IDs look like BEN-QXZT-1R3-42 (region "Benchmark") so benchmark parcels are easy to spot and never collide.
 */
class RegisterParcel extends MilkiWorkload {
  async initializeWorkloadModule(workerIndex, totalWorkers, roundIndex, roundArguments, sutAdapter, sutContext) {
    await super.initializeWorkloadModule(workerIndex, totalWorkers, roundIndex, roundArguments, sutAdapter, sutContext);
    this.tag = letters(4);
    this.n = 0;
  }

  async submitTransaction() {
    this.n += 1;
    const parcelId = `BEN-${this.tag}-${this.workerIndex}R${this.roundIndex}-${this.n}`;
    const parcel = {
      parcelId,
      titleNumber: `BEN/${this.tag}/${this.workerIndex}/${this.n}`,
      region: 'Benchmark',
      district: 'Caliper',
      ward: `Worker ${this.workerIndex}`,
      blockNumber: String(this.roundIndex),
      plotNumber: String(this.n),
      area: 500 + (this.n % 500),
      landUse: 'RESIDENTIAL',
      location: { latitude: -6.8, longitude: 39.28, boundary: null, address: null },
      ownerId: 'usr_000000000000000000caliper',
      ownerNidaHash: crypto.createHash('sha256').update(parcelId).digest('hex'),
    };
    await this.invoke('RegisterParcel', [JSON.stringify(parcel)]);
  }
}

module.exports.createWorkloadModule = () => new RegisterParcel();
