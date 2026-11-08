import { redis } from '../../core/datastores';
import { type EventContext, type MilkiEvent, onLedgerEvent } from '../../core/fabric/events';
import { syncEncumbrance } from '../encumbrances/encumbrance.service';
import { ledger } from '../../core/fabric/ledger';
import { emitToRole, emitToUser } from '../../core/socket';
import { AuditLog } from '../audit/audit.model';
import { DocumentFile } from '../documents/document-file.model';
import { enqueueNotification, type Localized, type NotificationJob } from '../notifications/notification.service';
import { ParcelCache } from '../parcels/parcel-cache.model';
import { registerParcelListener } from '../parcels/parcel.listener';
import { TransferCache } from '../transfers/transfer-cache.model';
import type { LedgerTransfer } from '../transfers/transfer.types';
import { User } from '../users/user.model';
import { displayName } from '../users/user.service';

/** Events older than this are history being replayed (first start / reconnect): cache + audit, but no alerts. */
const NOTIFY_MAX_AGE_MS = 60 * 60 * 1000;

// ------------------------------------------------------------------------------- transfer cache
export async function syncTransfer(transferId: string, blockNumber: number): Promise<LedgerTransfer> {
  const t = await ledger.evaluate<LedgerTransfer>('service', 'GetTransfer', [transferId]);
  await TransferCache.updateOne(
    { transferId },
    {
      transferId: t.transferId,
      parcelId: t.parcelId,
      sellerId: t.sellerId,
      buyerId: t.buyerId,
      status: t.status,
      verifiedBy: t.verifiedBy?.id,
      approvedBy: t.approvedBy?.id,
      closedReason: t.closedReason,
      steps: t.history.map((h) => ({ status: h.status, at: new Date(h.at), byRole: h.by.role, txId: h.txId })),
      ledgerCreatedAt: new Date(t.createdAt),
      ledgerUpdatedAt: new Date(t.updatedAt),
      lastTxId: t.lastTxId,
      lastBlock: blockNumber,
    },
    { upsert: true },
  );
  return t;
}

// -------------------------------------------------------------------------------- notifications
const name = async (userId: string | null | undefined): Promise<string> => {
  if (!userId) return '';
  const u = await User.findOne({ userId }, { fullName: 1 }).lean();
  return u ? displayName(u.fullName) : '';
};

async function ownerOf(parcelId: string): Promise<string | null> {
  return (await ParcelCache.findOne({ parcelId }, { ownerId: 1 }).lean())?.ownerId ?? null;
}

const L = (en: string, sw: string): Localized => ({ en, sw });
const endSentence = (s: string): string => (s.endsWith('.') ? s : `${s}.`);

/** Who hears about what (CLAUDE.md §11/§12). Returns null for events that need no alert. */
export async function buildNotification(e: MilkiEvent): Promise<NotificationJob | null> {
  const d = e.data ?? {};
  const pid = e.parcelId;
  const seller = typeof d.sellerId === 'string' ? d.sellerId : null;
  const buyer = typeof d.buyerId === 'string' ? d.buyerId : null;
  const base = { type: `${e.entity}.${e.action}`, data: { parcelId: pid, id: e.id, txId: e.txId, ...(e.entity === 'Transfer' ? { transferId: e.id } : {}) } };
  const job = (userIds: (string | null)[], title: Localized, body: Localized): NotificationJob => ({
    ...base,
    userIds: [...new Set(userIds.filter((u): u is string => Boolean(u)))],
    title,
    body,
  });

  switch (`${e.entity}.${e.action}`) {
    case 'Parcel.Registered':
      return job([await ownerOf(pid)], L('Parcel registered', 'Kiwanja kimesajiliwa'), L(`${pid} is now registered in your name on Milki.`, `${pid} sasa kimesajiliwa kwa jina lako kwenye Milki.`));
    case 'Parcel.Frozen':
      return job([await ownerOf(pid)], L('Parcel frozen', 'Kiwanja kimezuiliwa'), L(`The land registry has frozen ${pid}. Transfers are paused.`, `Msajili amezuia ${pid}. Uhamisho umesitishwa.`));
    case 'Parcel.Unfrozen':
      return job([await ownerOf(pid)], L('Parcel unfrozen', 'Kizuizi kimeondolewa'), L(`${pid} is no longer frozen.`, `${pid} hakijazuiliwa tena.`));
    case 'Parcel.Retired':
      return job([await ownerOf(pid)], L('Parcel retired', 'Kiwanja kimestaafishwa'), L(`${pid} has been retired from the register.`, `${pid} kimeondolewa kwenye daftari.`));

    case 'Transfer.Initiated': {
      const who = await name(seller);
      return job([buyer], L('Transfer awaiting you', 'Uhamisho unakusubiri'), L(`${who} wants to transfer ${pid} to you. Review and accept.`, `${who} anataka kukuhamishia ${pid}. Kagua na ukubali.`));
    }
    case 'Transfer.Accepted':
      return job([seller], L('Buyer accepted', 'Mnunuzi amekubali'), L(`The buyer accepted the transfer of ${pid}. A land officer will confirm payments next.`, `Mnunuzi amekubali uhamisho wa ${pid}. Afisa ardhi atathibitisha malipo.`));
    case 'Transfer.PaymentsConfirmed':
      return job([seller, buyer], L('Payments confirmed', 'Malipo yamethibitishwa'), L(`Payments for ${pid} are confirmed. Awaiting officer verification.`, `Malipo ya ${pid} yamethibitishwa. Inasubiri uhakiki wa afisa.`));
    case 'Transfer.Verified':
      return job([seller, buyer], L('Transfer verified', 'Uhamisho umehakikiwa'), L(`A land officer verified the transfer of ${pid}. Awaiting registrar approval.`, `Afisa ardhi amehakiki uhamisho wa ${pid}. Inasubiri idhini ya msajili.`));
    case 'Transfer.Approved':
      // The seller gets a different message (see notifyLedgerEvent).
      return job([buyer], L('You are the new owner', 'Wewe ni mmiliki mpya'), L(`Ownership of ${pid} is now recorded in your name.`, `Umiliki wa ${pid} sasa umesajiliwa kwa jina lako.`));
    case 'Transfer.Cancelled':
      return job([buyer], L('Transfer cancelled', 'Uhamisho umesitishwa'), L(`The seller cancelled the transfer of ${pid}.`, `Muuzaji amesitisha uhamisho wa ${pid}.`));
    case 'Transfer.Rejected': {
      const reason = typeof d.reason === 'string' ? ` ${d.reason}` : '';
      return job([seller, buyer], L('Transfer rejected', 'Uhamisho umekataliwa'), L(`The land registry rejected the transfer of ${pid}.${reason}`, `Ofisi ya ardhi imekataa uhamisho wa ${pid}.${reason}`));
    }

    case 'Encumbrance.Added':
      return job([await ownerOf(pid)], L('Mortgage registered', 'Rehani imesajiliwa'), L(`${String(d.lenderName ?? 'A bank')} registered a ${String(d.type ?? 'charge').toLowerCase()} on ${pid}.`, `${String(d.lenderName ?? 'Benki')} imesajili rehani kwenye ${pid}.`));
    case 'Encumbrance.Released':
      return job([await ownerOf(pid)], L('Mortgage released', 'Rehani imeondolewa'), L(`${String(d.lenderName ?? 'The bank')} released its ${String(d.type ?? 'charge').toLowerCase()} on ${pid}.`, `${String(d.lenderName ?? 'Benki')} imeondoa rehani kwenye ${pid}.`));
    case 'Dispute.Flagged':
      return job([await ownerOf(pid)], L('Dispute flagged', 'Mgogoro umeripotiwa'), L(`A land officer flagged a dispute on ${pid}. Transfers are paused until it is resolved.`, `Afisa ardhi ameripoti mgogoro kwenye ${pid}. Uhamisho umesitishwa hadi utatuliwe.`));
    case 'Dispute.Resolved':
      return job([await ownerOf(pid)], L('Dispute resolved', 'Mgogoro umetatuliwa'), L(`The dispute on ${pid} has been resolved.`, `Mgogoro kwenye ${pid} umetatuliwa.`));
    default:
      return null;
  }
}

/** Staff queues refresh live; involved users get stored + pushed notifications (once per transaction). */
export async function notifyLedgerEvent(e: MilkiEvent, ctx: EventContext): Promise<void> {
  const live = { event: ctx.name, id: e.id, parcelId: e.parcelId, status: e.status, txId: e.txId, blockNumber: ctx.blockNumber };
  emitToUser(e.actor.id, 'ledger:event', live);
  if (e.entity === 'Transfer') {
    for (const u of [e.data?.sellerId, e.data?.buyerId]) if (typeof u === 'string') emitToUser(u, 'ledger:event', live);
    if (['Accepted', 'PaymentsConfirmed'].includes(e.action)) emitToRole('LAND_OFFICER', 'queue:updated', live);
    if (e.action === 'Verified') emitToRole('REGISTRAR', 'queue:updated', live);
  }

  if (Date.now() - new Date(e.timestamp).getTime() > NOTIFY_MAX_AGE_MS) return;
  const first = await redis.set(`notif:done:${e.txId}`, '1', 'EX', 7 * 24 * 3600, 'NX');
  if (first !== 'OK') return;

  const job = await buildNotification(e);
  if (job) await enqueueNotification(job);
  if (e.entity === 'Transfer' && e.action === 'Approved') {
    const buyerName = await name(typeof e.data?.buyerId === 'string' ? e.data.buyerId : null);
    await enqueueNotification({
      type: 'Transfer.Approved',
      userIds: typeof e.data?.sellerId === 'string' ? [e.data.sellerId] : [],
      title: L('Transfer completed', 'Uhamisho umekamilika'),
      // Short names end in a full stop ("Juma H."), so don't add a second one.
      body: L(`Ownership of ${e.parcelId} has moved to ${endSentence(buyerName)}`, `Umiliki wa ${e.parcelId} umehamia kwa ${endSentence(buyerName)}`),
      data: { parcelId: e.parcelId, transferId: e.id, txId: e.txId },
    });
  }
}

/** Ledger-side audit trail; replays are idempotent (one entry per tx + action). */
export async function auditLedgerEvent(e: MilkiEvent, ctx: EventContext): Promise<void> {
  await AuditLog.updateOne(
    { txId: e.txId, action: `ledger.${e.entity}.${e.action}` },
    {
      $setOnInsert: {
        at: new Date(e.timestamp),
        actor: { userId: e.actor.id, role: e.actor.role ?? 'NONE' },
        entityType: e.entity,
        entityId: e.id,
        outcome: 'SUCCESS',
        meta: { parcelId: e.parcelId, status: e.status, blockNumber: ctx.blockNumber, mspId: e.actor.mspId },
      },
    },
    { upsert: true },
  );
}

/** Registers every ledger-event handler, in order: caches first, then audit, then notifications. */
export function registerLedgerListeners(): void {
  registerParcelListener();
  onLedgerEvent(async (e, ctx) => {
    if (e.entity === 'Transfer') await syncTransfer(e.id, ctx.blockNumber);
    if (e.entity === 'Encumbrance') await syncEncumbrance(e.id, ctx.blockNumber);
  });
  onLedgerEvent(async (e) => {
    if (e.entity !== 'Document') return;
    await DocumentFile.updateOne({ documentId: e.id }, { status: 'ATTACHED' });
    if (e.action === 'Superseded') {
      const fresh = await DocumentFile.findOne({ documentId: e.id }, { supersedes: 1 }).lean();
      if (fresh?.supersedes) await DocumentFile.updateOne({ documentId: fresh.supersedes }, { status: 'SUPERSEDED' });
    }
  });
  onLedgerEvent(auditLedgerEvent);
  onLedgerEvent(notifyLedgerEvent);
}
