'use client';

import { ArrowRight, BadgeCheck, Ban, ChevronLeft, LockKeyhole, Receipt, Stamp, UserRound } from 'lucide-react';
import Link from 'next/link';
import { use, useState } from 'react';
import { ConfirmAction } from '@/components/confirm-action';
import { CopyButton } from '@/components/copy-button';
import { DocumentList } from '@/components/document-list';
import { ErrorState, Fields, PageHeader } from '@/components/page';
import { StatusBadge } from '@/components/status-badge';
import { TransferTracker } from '@/components/transfer-tracker';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { ledgerWrite } from '@/lib/actions';
import { useAuth } from '@/lib/auth';
import { useSnapshotWhileOpen } from '@/lib/use-snapshot';
import { fmtDateTime, fmtMoney, MSP_LABEL, ROLE_LABEL, shortHash, titleCase } from '@/lib/format';
import { useParcel, useTransfer, useTransferDocuments } from '@/lib/queries';
import { TRANSFER_STATUS } from '@/lib/status';
import type { DocumentRef, Party, Transfer } from '@/lib/types';

const short = (p: Party) => {
  if (!p.fullName) return p.userId;
  const parts = p.fullName.split(/\s+/);
  return parts.length > 1 ? `${parts[0]} ${parts.at(-1)?.[0]}.` : p.fullName;
};

export function TransferPageClient({ params }: { params: Promise<{ transferId: string }> }) {
  const { transferId: raw } = use(params);
  const transferId = decodeURIComponent(raw).toUpperCase();
  const t = useTransfer(transferId);
  if (t.isError)
    return (
      <>
        <BackLink />
        <ErrorState error={t.error} onRetry={() => void t.refetch()} />
      </>
    );
  if (!t.data)
    return (
      <div className="space-y-4" aria-busy="true">
        <BackLink />
        <Skeleton className="h-10 w-80" />
        <Skeleton className="h-28" />
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-64 lg:col-span-2" />
          <Skeleton className="h-64" />
        </div>
      </div>
    );
  return <TransferView t={t.data} />;
}

function BackLink() {
  return (
    <Link href="/transfers" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
      <ChevronLeft className="size-4" /> Transfers
    </Link>
  );
}

function TransferView({ t }: { t: Transfer }) {
  const { hasRole } = useAuth();
  const docs = useTransferDocuments(t.transferId);
  const parcel = useParcel(t.parcelId);
  // Actions render from a snapshot while a dialog is open, so a commit doesn't unmount it mid-seal.
  const [a, lock] = useSnapshotWhileOpen(t);
  const open = !['COMPLETED', 'CANCELLED', 'REJECTED', 'APPROVED'].includes(a.status);

  return (
    <>
      <BackLink />
      <PageHeader
        eyebrow="Land transfer"
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span className="font-mono">{t.transferId}</span>
            <StatusBadge kind="transfer" status={t.status} />
          </span>
        }
        description={
          <>
            Parcel{' '}
            <Link href={`/parcels/${t.parcelId}`} className="font-mono font-medium text-primary hover:underline">
              {t.parcelId}
            </Link>{' '}
            · {TRANSFER_STATUS[t.status].description}
          </>
        }
        actions={
          <>
            {hasRole('LAND_OFFICER') && a.status === 'BUYER_ACCEPTED' && <ConfirmPayments t={a} documents={docs.data ?? []} lock={lock} />}
            {hasRole('LAND_OFFICER') && a.status === 'PAYMENTS_CONFIRMED' && <Verify t={a} lock={lock} />}
            {hasRole('REGISTRAR') && a.status === 'OFFICER_VERIFIED' && <Approve t={a} lock={lock} />}
            {open && ((hasRole('LAND_OFFICER') && a.status !== 'OFFICER_VERIFIED') || hasRole('REGISTRAR')) && <Reject t={a} lock={lock} />}
          </>
        }
      />

      <Card className="mb-4">
        <CardContent className="pt-6">
          <TransferTracker transfer={t} />
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Parties</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
              <PartyCard label="Seller (current owner)" p={t.seller} />
              <ArrowRight className="mx-auto size-5 shrink-0 rotate-90 text-gold-ink sm:rotate-0" aria-hidden />
              <PartyCard label="Buyer" p={t.buyer} />
            </div>
            {parcel.data && (
              <p className="mt-4 text-sm text-muted-foreground">
                Parcel status now: <StatusBadge kind="parcel" status={parcel.data.status} size="sm" /> · {parcel.data.ward}, {parcel.data.district}
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <LockKeyhole className="size-4 text-gold-ink" aria-hidden /> Sale details
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {t.sale ? (
              <p className="text-2xl font-bold tabular-nums">{fmtMoney(t.sale.salePrice, t.sale.currency)}</p>
            ) : (
              <p className="text-sm text-muted-foreground">Not visible to your role.</p>
            )}
            <p className="text-xs text-muted-foreground">Private data: stored only on Ministry and Land Office peers, never on the shared ledger.</p>
            <Fields
              className="pt-2 sm:grid-cols-1"
              items={[
                { label: 'Payment reference', value: t.paymentReference ?? 'Not confirmed yet', mono: Boolean(t.paymentReference) },
                {
                  label: 'Payment evidence (SHA-256)',
                  value: t.paymentEvidenceHash ? (
                    <span className="inline-flex items-center gap-1 font-mono text-sm">
                      {shortHash(t.paymentEvidenceHash)} <CopyButton value={t.paymentEvidenceHash} label="Copy hash" />
                    </span>
                  ) : (
                    '-'
                  ),
                },
              ]}
            />
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Documents</CardTitle>
          </CardHeader>
          <CardContent>{docs.data ? <DocumentList documents={docs.data} /> : <Skeleton className="h-24" />}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Ledger steps</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="space-y-3">
              {[...t.history].reverse().map((h) => (
                <li key={`${h.txId}-${h.status}`} className="border-l-2 border-primary/30 pl-3">
                  <p className="text-sm font-semibold">{TRANSFER_STATUS[h.status].label}</p>
                  <p className="text-xs text-muted-foreground">
                    {fmtDateTime(h.at)} · {ROLE_LABEL[h.by.role ?? ''] ?? '-'} · {MSP_LABEL[h.by.mspId] ?? h.by.mspId}
                  </p>
                  {h.note && <p className="text-sm">“{h.note}”</p>}
                  <p className="flex items-center gap-1 font-mono text-[11px] text-muted-foreground">
                    {shortHash(h.txId)} <CopyButton value={h.txId} label="Copy transaction ID" />
                  </p>
                </li>
              ))}
            </ol>
            {t.closedReason && <p className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-sm">Reason: {t.closedReason}</p>}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function PartyCard({ label, p }: { label: string; p: Party }) {
  return (
    <div className="flex-1 rounded-lg border bg-muted/30 p-3">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 flex items-center gap-1.5 font-semibold">
        <UserRound className="size-4 text-muted-foreground" aria-hidden />
        {p.fullName ?? 'Landowner'}
      </p>
      {p.phone && <p className="text-sm text-muted-foreground">{p.phone}</p>}
      <p className="font-mono text-[11px] text-muted-foreground">{p.userId}</p>
    </div>
  );
}

function NoteField({ id, label, value, onChange, required }: { id: string; label: string; value: string; onChange: (v: string) => void; required?: boolean }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>
        {label}
        {!required && <span className="font-normal text-muted-foreground"> (optional)</span>}
      </Label>
      <Textarea id={id} rows={3} maxLength={500} value={value} onChange={(e) => onChange(e.target.value)} />
      <p className="text-xs text-muted-foreground">Recorded on the ledger, with no personal data.</p>
    </div>
  );
}

function ConfirmPayments({ t, documents, lock }: { t: Transfer; documents: DocumentRef[]; lock: (open: boolean) => void }) {
  const receipts = documents.filter((d) => d.status === 'ACTIVE');
  const [evidence, setEvidence] = useState('');
  const [ref, setRef] = useState('');
  const chosen = receipts.find((d) => d.documentId === evidence);
  return (
    <ConfirmAction
      tier="T3"
      title="Confirm payments"
      description="Check the receipts (purchase price and TRA fees) attached to this transfer, then record the confirmation."
      trigger={
        <Button>
          <Receipt /> Confirm payments
        </Button>
      }
      impact={[
        { label: 'Payment reference', value: ref || '-', mono: true },
        { label: 'Evidence', value: chosen ? `${titleCase(chosen.documentType)} · ${shortHash(chosen.sha256)}` : '-' },
      ]}
      canConfirm={ref.trim().length >= 3 && Boolean(chosen)}
      successMessage="Payments confirmed."
      onConfirm={(ctx) => ledgerWrite('post', `/transfers/${t.transferId}/confirm-payments`, { paymentReference: ref.trim(), evidenceDocumentId: evidence }, ctx)}
      onOpenChange={(o) => {
        lock(o);
        if (!o) return;
        setRef('');
        setEvidence(receipts[0]?.documentId ?? '');
      }}
    >
      {receipts.length === 0 ? (
        <p className="rounded-md bg-warning/10 px-3 py-2 text-sm">No receipt is attached to this transfer yet. Ask the buyer to upload proof of payment first.</p>
      ) : (
        <div className="space-y-1.5">
          <Label htmlFor="evidence">Receipt used as evidence</Label>
          <Select value={evidence} onValueChange={setEvidence}>
            <SelectTrigger id="evidence" className="w-full">
              <SelectValue placeholder="Choose a document" />
            </SelectTrigger>
            <SelectContent>
              {receipts.map((d) => (
                <SelectItem key={d.documentId} value={d.documentId}>
                  {titleCase(d.documentType)} · {d.file?.name ?? d.documentId}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="payref">Payment / TRA reference</Label>
        <Input id="payref" className="font-mono" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="TRA-2026-000981" />
      </div>
    </ConfirmAction>
  );
}

function Verify({ t, lock }: { t: Transfer; lock: (open: boolean) => void }) {
  const [note, setNote] = useState('');
  return (
    <ConfirmAction
      tier="T3"
      title="Verify transfer"
      trigger={
        <Button>
          <BadgeCheck /> Verify
        </Button>
      }
      impactSentence={
        <>
          You confirm the documents and payments for <span className="font-mono">{t.parcelId}</span> are in order. The transfer goes to a registrar for final approval.
        </>
      }
      successMessage="Transfer verified."
      onConfirm={(ctx) => ledgerWrite('post', `/transfers/${t.transferId}/verify`, note.trim() ? { note: note.trim() } : {}, ctx)}
      onOpenChange={(o) => {
        lock(o);
        if (o) setNote('');
      }}
    >
      <NoteField id="verify-note" label="Verification note" value={note} onChange={setNote} />
    </ConfirmAction>
  );
}

function Approve({ t, lock }: { t: Transfer; lock: (open: boolean) => void }) {
  const [note, setNote] = useState('');
  return (
    <ConfirmAction
      tier="T3"
      title="Approve transfer"
      trigger={
        <Button>
          <Stamp /> Approve
        </Button>
      }
      impactSentence={
        <>
          Ownership of <span className="font-mono">{t.parcelId}</span> will move from <strong>{short(t.seller)}</strong> to <strong>{short(t.buyer)}</strong>.
        </>
      }
      impact={[
        { label: 'Verified by', value: t.verifiedBy ? `${ROLE_LABEL[t.verifiedBy.role ?? '']} · ${MSP_LABEL[t.verifiedBy.mspId]}` : '-' },
        { label: 'Payment reference', value: t.paymentReference ?? '-', mono: true },
        ...(t.sale ? [{ label: 'Sale price (private)', value: fmtMoney(t.sale.salePrice, t.sale.currency) }] : []),
      ]}
      confirmLabel="Sign and approve"
      successMessage="Transfer approved. Ownership moved."
      onConfirm={(ctx) => ledgerWrite('post', `/transfers/${t.transferId}/approve`, note.trim() ? { note: note.trim() } : {}, ctx)}
      onOpenChange={(o) => {
        lock(o);
        if (o) setNote('');
      }}
    >
      <NoteField id="approve-note" label="Approval note" value={note} onChange={setNote} />
    </ConfirmAction>
  );
}

function Reject({ t, lock }: { t: Transfer; lock: (open: boolean) => void }) {
  const [reason, setReason] = useState('');
  return (
    <ConfirmAction
      tier="T3"
      title="Reject transfer"
      trigger={
        <Button variant="destructive">
          <Ban /> Reject
        </Button>
      }
      impactSentence={
        <>
          The transfer of <span className="font-mono">{t.parcelId}</span> will be closed. Ownership stays with <strong>{short(t.seller)}</strong>.
        </>
      }
      consequences={['Both parties are notified with your reason.', 'A rejected transfer cannot be reopened; the seller would have to start a new one.']}
      typeToConfirm={t.transferId}
      canConfirm={reason.trim().length >= 3}
      confirmLabel="Sign and reject"
      successMessage="Transfer rejected."
      onConfirm={(ctx) => ledgerWrite('post', `/transfers/${t.transferId}/reject`, { reason: reason.trim() }, ctx)}
      onOpenChange={(o) => {
        lock(o);
        if (o) setReason('');
      }}
    >
      <NoteField id="reject-reason" label="Reason (sent to both parties)" value={reason} onChange={setReason} required />
    </ConfirmAction>
  );
}
