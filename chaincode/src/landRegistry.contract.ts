import { Context, Contract, Info, Returns, Transaction } from 'fabric-contract-api';
import { MilkiError } from './errors';
import { stableStringify } from './ledger';
import * as disputes from './services/dispute.service';
import * as documents from './services/document.service';
import * as encumbrances from './services/encumbrance.service';
import * as parcels from './services/parcel.service';
import * as transfers from './services/transfer.service';

export const CONTRACT_NAME = 'land-registry';
export const CONTRACT_VERSION = '1.0.0';

const out = (value: unknown): string => stableStringify(value);

/**
 * Milki land registry (CLAUDE.md §7.1). Every write emits `milki.<Entity>.<Action>`; nothing is ever deleted.
 * All arguments are strings; structured input is JSON. Errors are JSON `{ code, message, details? }`.
 */
@Info({ title: 'Milki Land Registry', description: 'Parcels, transfers, encumbrances, disputes and document references' })
export class LandRegistryContract extends Contract {
  constructor() {
    super(CONTRACT_NAME);
  }

  public override async unknownTransaction(ctx: Context): Promise<void> {
    const { fcn } = ctx.stub.getFunctionAndParameters();
    throw new MilkiError('NOT_FOUND', `Unknown chaincode function: ${fcn}.`);
  }

  /** Read-only health probe used by deploy-cc.sh and the backend gateway pool. */
  @Transaction(false)
  @Returns('string')
  public async GetContractInfo(_ctx: Context): Promise<string> {
    return out({ name: CONTRACT_NAME, version: CONTRACT_VERSION });
  }

  // ---------------------------------------------------------------- Parcel
  @Transaction()
  @Returns('string')
  public async RegisterParcel(ctx: Context, parcelJson: string): Promise<string> {
    return out(await parcels.registerParcel(ctx, parcelJson));
  }

  @Transaction(false)
  @Returns('string')
  public async GetParcel(ctx: Context, parcelId: string): Promise<string> {
    return out(await parcels.getParcel(ctx, parcelId));
  }

  @Transaction(false)
  @Returns('string')
  public async GetParcelHistory(ctx: Context, parcelId: string): Promise<string> {
    return out(await parcels.getParcelHistory(ctx, parcelId));
  }

  @Transaction(false)
  @Returns('string')
  public async GetParcelTransfers(ctx: Context, parcelId: string): Promise<string> {
    return out(await parcels.getParcelTransfers(ctx, parcelId));
  }

  /** queryJson: { selector?, sort? }, CouchDB rich query, docType is forced to "parcel". */
  @Transaction(false)
  @Returns('string')
  public async QueryParcels(ctx: Context, queryJson: string, pageSize: string, bookmark: string): Promise<string> {
    return out(await parcels.queryParcels(ctx, queryJson, pageSize, bookmark));
  }

  @Transaction()
  @Returns('string')
  public async UpdateParcel(ctx: Context, parcelId: string, patchJson: string): Promise<string> {
    return out(await parcels.updateParcel(ctx, parcelId, patchJson));
  }

  @Transaction()
  @Returns('string')
  public async FreezeParcel(ctx: Context, parcelId: string, reason: string): Promise<string> {
    return out(await parcels.freezeParcel(ctx, parcelId, reason));
  }

  @Transaction()
  @Returns('string')
  public async UnfreezeParcel(ctx: Context, parcelId: string, reason: string): Promise<string> {
    return out(await parcels.unfreezeParcel(ctx, parcelId, reason));
  }

  @Transaction()
  @Returns('string')
  public async RetireParcel(ctx: Context, parcelId: string, reason: string): Promise<string> {
    return out(await parcels.retireParcel(ctx, parcelId, reason));
  }

  // -------------------------------------------------------------- Transfer
  /** Private sale details travel in the transient map under key "transfer". */
  @Transaction()
  @Returns('string')
  public async InitiateTransfer(ctx: Context, parcelId: string, buyerId: string, buyerNidaHash: string): Promise<string> {
    return out(await transfers.initiateTransfer(ctx, parcelId, buyerId, buyerNidaHash));
  }

  @Transaction(false)
  @Returns('string')
  public async GetTransfer(ctx: Context, transferId: string): Promise<string> {
    return out(await transfers.getTransfer(ctx, transferId));
  }

  @Transaction(false)
  @Returns('string')
  public async QueryTransfers(ctx: Context, queryJson: string, pageSize: string, bookmark: string): Promise<string> {
    return out(await transfers.queryTransfers(ctx, queryJson, pageSize, bookmark));
  }

  @Transaction(false)
  @Returns('string')
  public async GetTransferPrivateDetails(ctx: Context, transferId: string): Promise<string> {
    return out(await transfers.getTransferPrivateDetails(ctx, transferId));
  }

  @Transaction()
  @Returns('string')
  public async AcceptTransfer(ctx: Context, transferId: string): Promise<string> {
    return out(await transfers.acceptTransfer(ctx, transferId));
  }

  @Transaction()
  @Returns('string')
  public async ConfirmPayments(ctx: Context, transferId: string, paymentReference: string, paymentEvidenceHash: string): Promise<string> {
    return out(await transfers.confirmPayments(ctx, transferId, paymentReference, paymentEvidenceHash));
  }

  @Transaction()
  @Returns('string')
  public async VerifyTransfer(ctx: Context, transferId: string, note: string): Promise<string> {
    return out(await transfers.verifyTransfer(ctx, transferId, note));
  }

  @Transaction()
  @Returns('string')
  public async ApproveTransfer(ctx: Context, transferId: string, note: string): Promise<string> {
    return out(await transfers.approveTransfer(ctx, transferId, note));
  }

  @Transaction()
  @Returns('string')
  public async CancelTransfer(ctx: Context, transferId: string, reason: string): Promise<string> {
    return out(await transfers.cancelTransfer(ctx, transferId, reason));
  }

  @Transaction()
  @Returns('string')
  public async RejectTransfer(ctx: Context, transferId: string, reason: string): Promise<string> {
    return out(await transfers.rejectTransfer(ctx, transferId, reason));
  }

  // ----------------------------------------------------------- Encumbrance
  @Transaction()
  @Returns('string')
  public async AddEncumbrance(ctx: Context, parcelId: string, encumbranceJson: string): Promise<string> {
    return out(await encumbrances.addEncumbrance(ctx, parcelId, encumbranceJson));
  }

  @Transaction(false)
  @Returns('string')
  public async GetEncumbrances(ctx: Context, parcelId: string): Promise<string> {
    return out(await encumbrances.getEncumbrances(ctx, parcelId));
  }

  @Transaction(false)
  @Returns('string')
  public async GetEncumbrance(ctx: Context, encumbranceId: string): Promise<string> {
    return out(await encumbrances.getEncumbrance(ctx, encumbranceId));
  }

  @Transaction()
  @Returns('string')
  public async UpdateEncumbrance(ctx: Context, encumbranceId: string, patchJson: string): Promise<string> {
    return out(await encumbrances.updateEncumbrance(ctx, encumbranceId, patchJson));
  }

  @Transaction()
  @Returns('string')
  public async ReleaseEncumbrance(ctx: Context, encumbranceId: string, reason: string): Promise<string> {
    return out(await encumbrances.releaseEncumbrance(ctx, encumbranceId, reason));
  }

  // --------------------------------------------------------------- Dispute
  @Transaction()
  @Returns('string')
  public async FlagDispute(ctx: Context, parcelId: string, disputeJson: string): Promise<string> {
    return out(await disputes.flagDispute(ctx, parcelId, disputeJson));
  }

  @Transaction(false)
  @Returns('string')
  public async GetDisputes(ctx: Context, parcelId: string): Promise<string> {
    return out(await disputes.getDisputes(ctx, parcelId));
  }

  @Transaction()
  @Returns('string')
  public async AddDisputeNote(ctx: Context, disputeId: string, note: string): Promise<string> {
    return out(await disputes.addDisputeNote(ctx, disputeId, note));
  }

  @Transaction()
  @Returns('string')
  public async ResolveDispute(ctx: Context, disputeId: string, resolution: string): Promise<string> {
    return out(await disputes.resolveDispute(ctx, disputeId, resolution));
  }

  // ------------------------------------------------------------- Documents
  @Transaction()
  @Returns('string')
  public async AttachDocument(ctx: Context, documentJson: string): Promise<string> {
    return out(await documents.attachDocument(ctx, documentJson));
  }

  @Transaction()
  @Returns('string')
  public async SupersedeDocument(ctx: Context, documentId: string, sha256: string): Promise<string> {
    return out(await documents.supersedeDocument(ctx, documentId, sha256));
  }

  @Transaction(false)
  @Returns('string')
  public async GetDocuments(ctx: Context, targetType: string, targetId: string): Promise<string> {
    return out(await documents.getDocuments(ctx, targetType, targetId));
  }

  @Transaction(false)
  @Returns('string')
  public async VerifyDocument(ctx: Context, documentId: string, sha256: string): Promise<string> {
    return out(await documents.verifyDocument(ctx, documentId, sha256));
  }
}
