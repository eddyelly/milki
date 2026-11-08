'use strict';

const { MilkiWorkload } = require('./common');

const REGIONS = ['Dar es Salaam', 'Arusha', 'Mwanza'];

/** CouchDB rich query by region and status, sorted (uses the indexes in META-INF/statedb/couchdb). */
class QueryParcels extends MilkiWorkload {
  async submitTransaction() {
    const selector = { region: this.pick(REGIONS), status: 'ACTIVE' };
    await this.query('QueryParcels', [JSON.stringify({ selector }), String(this.roundArguments.pageSize ?? 20), '']);
  }
}

module.exports.createWorkloadModule = () => new QueryParcels();
