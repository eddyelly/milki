'use strict';

const { MilkiWorkload } = require('./common');

/** Full key history of a parcel (the ownership chain shown in the apps). */
class GetParcelHistory extends MilkiWorkload {
  async initializeWorkloadModule(workerIndex, totalWorkers, roundIndex, roundArguments, sutAdapter, sutContext) {
    await super.initializeWorkloadModule(workerIndex, totalWorkers, roundIndex, roundArguments, sutAdapter, sutContext);
    this.ids = await this.loadParcelIds();
  }

  async submitTransaction() {
    await this.query('GetParcelHistory', [this.pick(this.ids)]);
  }
}

module.exports.createWorkloadModule = () => new GetParcelHistory();
