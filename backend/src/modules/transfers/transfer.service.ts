import type { QueryFilter } from 'mongoose';
import type { AuthUser } from '../../core/auth';
import { piiHash } from '../../core/crypto';
import { badRequest, forbidden, notFound } from '../../core/errors';
import { ledger } from '../../core/fabric/ledger';
import { logger } from '../../core/logger';
import { DocumentFile } from '../documents/document-file.model';
import { User } from '../users/user.model';
import { toWalletUser } from '../users/user.service';
import { TransferCache, type TransferCacheAttrs } from './transfer-cache.model';
import type { ConfirmPaymentsBody, InitiateBody, TransferListQuery } from './transfer.schema';
import type { LedgerTransfer, TransferPrivateDetails } from './transfer.types';

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A masked reference to a NIDA number for the private collection — never the number itself. */
const nidaRef = (last4: string | null | undefined) => `NIDA••••${last4 ?? '????'}`;

async function activeCitizen(filter: Record<string, unknown>, who: string) {
  const u = await User.findOne({ ...filter, role: 'CITIZEN', deletedAt: null }).lean();
  if (!u) throw notFound(`No active Milki landowner matches the ${who} details.`, 'USER_NOT_FOUND');
  if (u.status !== 'ACTIVE') throw badRequest(`The ${who} has not finished verifying their Milki account.`, undefined, 'USER_NOT_ACTIVE');
  if (!u.nidaHash) throw badRequest(`The ${who} has no NIDA number on file.`, undefined, 'USER_NIDA_MISSING');
  return u;
}

// ------------------------------------------------------------------------------------------ writes
/** Seller starts a sale. Price, NIDA references and contact hashes travel only in the transient map. */
export async function initiate(user: AuthUser, body: InitiateBody) {
  const seller = await activeCitizen({ userId: user.userId }, 'seller');
  const b = body.buyer;
  const buyer = await activeCitizen('userId' in b ? { userId: b.userId } : 'phone' in b ? { phone: b.phone } : { nidaHash: piiHash(b.nida) }, 'buyer');
  if (buyer.userId === seller.userId) throw badRequest('You cannot transfer a parcel to yourself.', undefined, 'SELF_TRANSFER');

  const transient = {
    transfer: {
      salePrice: body.salePrice,
      currency: body.currency,
      sellerNidaRef: nidaRef(seller.nidaLast4),
      buyerNidaRef: nidaRef(buyer.nidaLast4),
      sellerContactHash: piiHash(seller.phone),
      buyerContactHash: piiHash(buyer.phone),
    },
  };
  const res = await ledger.submit<LedgerTransfer>(await toWalletUser(user), 'InitiateTransfer', [body.parcelId, buyer.userId, buyer.nidaHash as string], {
    transient,
    entityType: 'Transfer',
    entityId: body.parcelId,
  });
  return { txId: res.txId, transferId: res.result.transferId, parcelId: body.parcelId, buyerId: buyer.userId };
}

type Action = 'AcceptTransfer' | 'VerifyTransfer' | 'ApproveTransfer' | 'CancelTransfer' | 'RejectTransfer';

/** Accept / verify / approve / cancel / reject: one string argument after the transfer ID (or none). */
export async function act(user: AuthUser, transferId: string, fn: Action, text?: string) {
  const args = fn === 'AcceptTransfer' ? [transferId] : [transferId, text ?? ''];
  const res = await ledger.submit<LedgerTransfer>(await toWalletUser(user), fn, args, { entityType: 'Transfer', entityId: transferId });
  return { txId: res.txId, transferId, status: res.result.status };
}

/** The receipt must already be on the ledger as a document of this transfer; its hash is the evidence. */
export async function confirmPayments(user: AuthUser, transferId: string, body: ConfirmPaymentsBody) {
  const doc = await DocumentFile.findOne({ documentId: body.evidenceDocumentId, deletedAt: null }).lean();
  if (!doc || doc.targetType !== 'TRANSFER' || doc.targetId !== transferId) {
    throw badRequest('That receipt is not attached to this transfer. Upload it to the transfer first.', undefined, 'EVIDENCE_NOT_FOUND');
  }
  const res = await ledger.submit<LedgerTransfer>(
    await toWalletUser(user),
    'ConfirmPayments',
    [transferId, body.paymentReference, doc.sha256],
    { entityType: 'Transfer', entityId: transferId },
  );
  return { txId: res.txId, transferId, status: res.result.status };
}

// ------------------------------------------------------------------------------------------- reads
async function party(userId: string) {
  const u = await User.findOne({ userId }, { userId: 1, fullName: 1, phone: 1 }).lean();
  return u ? { userId: u.userId, fullName: u.fullName, phone: u.phone } : { userId };
}

/** From the ledger. Parties and land officials also get the private sale price (via the Org1/Org2 peers). */
export async function get(user: AuthUser, transferId: string) {
  if (user.role === 'BANK_OFFICER') throw forbidden('Banks can verify ownership but cannot view transfers.');
  const wu = await toWalletUser(user);
  const t = await ledger.evaluate<LedgerTransfer>(wu, 'GetTransfer', [transferId]);
  const isParty = user.userId === t.sellerId || user.userId === t.buyerId;
  if (user.role === 'CITIZEN' && !isParty) throw forbidden('You can only view transfers you are part of.');

  let sale: { salePrice: number; currency: string } | null = null;
  if ((user.role === 'CITIZEN' && isParty) || user.role === 'LAND_OFFICER' || user.role === 'REGISTRAR') {
    try {
      const p = await ledger.evaluate<TransferPrivateDetails>(wu, 'GetTransferPrivateDetails', [transferId]);
      sale = { salePrice: p.salePrice, currency: p.currency };
    } catch (err) {
      logger.warn({ transferId, err: (err as Error).message }, 'private sale details unavailable');
    }
  }
  const { buyerNidaHash: _hidden, ...rest } = t;
  const [seller, buyer] = await Promise.all([party(t.sellerId), party(t.buyerId)]);
  return { ...rest, seller, buyer, sale };
}

export async function list(user: AuthUser, q: TransferListQuery): Promise<{ items: TransferCacheAttrs[]; total: number }> {
  if (user.role === 'BANK_OFFICER') throw forbidden('Banks can verify ownership but cannot list transfers.');
  const and: QueryFilter<TransferCacheAttrs>[] = [];
  if (user.role === 'CITIZEN') {
    if (q.role === 'seller') and.push({ sellerId: user.userId });
    else if (q.role === 'buyer') and.push({ buyerId: user.userId });
    else and.push({ $or: [{ sellerId: user.userId }, { buyerId: user.userId }] });
  }
  if (q.status?.length) and.push({ status: { $in: q.status } });
  if (q.parcelId) and.push({ parcelId: q.parcelId.toUpperCase() });
  if (q.q) {
    const rx = new RegExp(escapeRegex(q.q), 'i');
    and.push({ $or: [{ transferId: rx }, { parcelId: rx }] });
  }
  const filter: QueryFilter<TransferCacheAttrs> = and.length ? { $and: and } : {};
  const field = q.sort.replace('-', '') === 'createdAt' ? 'ledgerCreatedAt' : 'ledgerUpdatedAt';
  const [items, total] = await Promise.all([
    TransferCache.find(filter)
      .sort({ [field]: q.sort.startsWith('-') ? -1 : 1, transferId: 1 })
      .skip((q.page - 1) * q.limit)
      .limit(q.limit)
      .lean(),
    TransferCache.countDocuments(filter),
  ]);
  return { items: items as TransferCacheAttrs[], total };
}
