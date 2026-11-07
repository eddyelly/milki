import { Context, Contract, Info, Transaction } from 'fabric-contract-api';

export const CONTRACT_NAME = 'land-registry';
export const CONTRACT_VERSION = '0.1.0';

@Info({ title: 'Milki Land Registry', description: 'Parcels, transfers, encumbrances, disputes and document references' })
export class LandRegistryContract extends Contract {
  constructor() {
    super(CONTRACT_NAME);
  }

  /** Read-only health probe used by deploy-cc.sh and the backend gateway pool. */
  @Transaction(false)
  public async GetContractInfo(_ctx: Context): Promise<string> {
    return JSON.stringify({ name: CONTRACT_NAME, version: CONTRACT_VERSION });
  }
}
