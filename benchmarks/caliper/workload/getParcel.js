'use strict';

const { MilkiWorkload } = require('./common');

/** Point read of one parcel (state DB key lookup) — the hot path behind QR verification and the partner API. */
class GetParcel extends MilkiWorkload {
  async initializeWorkloadModule(workerIndex, totalWorkers, roundIndex, roundArguments, sutAdapter, sutContext) {
    await super.initializeWorkloadModule(workerIndex, totalWorkers, roundIndex, roundArguments, sutAdapter, sutContext);
    this.ids = await this.loadParcelIds();
  }

  async submitTransaction() {
    await this.query('GetParcel', [this.pick(this.ids)]);
  }
}

module.exports.createWorkloadModule = () => new GetParcel();
