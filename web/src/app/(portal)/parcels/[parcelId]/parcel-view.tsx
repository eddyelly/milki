'use client';

import {
  ArrowLeftRight,
  ChevronLeft,
  Landmark,
  Link2,
  MapPin,
  Pencil,
  Snowflake,
  Sun,
  TriangleAlert,
  Archive,
  UserRound,
} from 'lucide-react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { use, useState } from 'react';
import { ConfirmAction } from '@/components/confirm-action';
import { CopyButton } from '@/components/copy-button';
import { DocumentList } from '@/components/document-list';
import { OwnershipChain } from '@/components/ownership-chain';
import { EmptyState, ErrorState, Fields, PageHeader } from '@/components/page';
import { StatusBadge } from '@/components/status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { ledgerWrite } from '@/lib/actions';
import { useAuth } from '@/lib/auth';
import { useSnapshotWhileOpen } from '@/lib/use-snapshot';
import { fmtArea, fmtDate, fmtDateTime, fmtMoney, MSP_LABEL, ROLE_LABEL, shortHash, titleCase } from '@/lib/format';
import { useParcel, useParcelDisputes, useParcelDocuments, useParcelEncumbrances, useParcelHistory, useParcelTransfers } from '@/lib/queries';
import { LAND_USES, type Parcel } from '@/lib/types';

const ParcelMap = dynamic(() => import('@/components/parcel-map'), { ssr: false, loading: () => <Skeleton className="h-64 rounded-xl" /> });

export function ParcelPageClient({ params }: { params: Promise<{ parcelId: string }> }) {
  const { parcelId: raw } = use(params);
  const parcelId = decodeURIComponent(raw).toUpperCase();
  const parcel = useParcel(parcelId);

  if (parcel.isError) {
    return (
      <>
        <BackLink />
        <ErrorState error={parcel.error} onRetry={() => void parcel.refetch()} />
      </>
    );
  }
  if (!parcel.data) {
    return (
      <div className="space-y-4" aria-busy="true">
        <BackLink />
        <Skeleton className="h-10 w-72" />
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-72 lg:col-span-2" />
          <Skeleton className="h-72" />
        </div>
      </div>
    );
  }
  return <ParcelView p={parcel.data} />;
}

function BackLink() {
  return (
    <Link href="/parcels" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
      <ChevronLeft className="size-4" /> Parcels
    </Link>
  );
}

function ParcelView({ p }: { p: Parcel }) {
  const { hasRole } = useAuth();
  // Actions render from a snapshot while a dialog is open, so a commit doesn't swap/unmount it mid-seal.
  const [a, lock] = useSnapshotWhileOpen(p);
  return (
    <>
      <BackLink />
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-1">
            Title <span className="font-mono normal-case">{p.titleNumber}</span>
          </span>
        }
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span className="font-mono">{p.parcelId}</span>
            <StatusBadge kind="parcel" status={p.status} />
          </span>
        }
        description={
          <>
            {p.ward}, {p.district}, {p.region} · read from the ledger just now
          </>
        }
        actions={
          <>
            {hasRole('LAND_OFFICER') && !a.retired && <FlagDispute p={a} lock={lock} />}
            {hasRole('REGISTRAR') && !a.retired && (
              <>
                <EditParcel p={a} lock={lock} />
                <FreezeToggle p={a} unfreeze={a.frozen} lock={lock} />
                <RetireParcel p={a} lock={lock} />
              </>
            )}
          </>
        }
      />

      <StateBanner p={p} />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Parcel details</CardTitle>
          </CardHeader>
          <CardContent>
            <Fields
              items={[
                { label: 'Block / plot', value: `${p.blockNumber} / ${p.plotNumber}` },
                { label: 'Area', value: fmtArea(p.area) },
                { label: 'Land use', value: titleCase(p.landUse) },
                { label: 'Ownership version', value: `v${p.ownershipVersion}` },
                { label: 'Registered', value: fmtDate(p.createdAt) },
                { label: 'Last change', value: `${fmtDateTime(p.updatedAt)} · ${ROLE_LABEL[p.updatedBy.role ?? ''] ?? '—'} (${MSP_LABEL[p.updatedBy.mspId] ?? p.updatedBy.mspId})` },
                {
                  label: 'Last transaction',
                  value: (
                    <span className="inline-flex items-center gap-1 font-mono text-sm">
                      {shortHash(p.lastTxId)} <CopyButton value={p.lastTxId} label="Copy transaction ID" />
                    </span>
                  ),
                },
                { label: 'Address', value: p.location.address ?? '—' },
              ]}
            />
            {p.lastChangeNote && <p className="mt-4 rounded-md bg-muted/60 px-3 py-2 text-sm text-muted-foreground">Registry note: “{p.lastChangeNote}”</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserRound className="size-4 text-gold-ink" aria-hidden /> Registered owner
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            <p className="text-lg font-semibold">{p.owner.fullName ?? 'Landowner'}</p>
            {p.owner.phone && <p className="text-sm text-muted-foreground">{p.owner.phone}</p>}
            <p className="font-mono text-xs text-muted-foreground">{p.owner.userId}</p>
            <p className="pt-2 text-xs text-muted-foreground">The owner’s NIDA number is never stored on the ledger — only a salted fingerprint.</p>
          </CardContent>
        </Card>
        <Card className="lg:col-span-3">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <MapPin className="size-4 text-primary" aria-hidden /> Location
            </CardTitle>
            <span className="font-mono text-xs text-muted-foreground">
              {p.location.latitude.toFixed(5)}, {p.location.longitude.toFixed(5)}
            </span>
          </CardHeader>
          <CardContent>
            <ParcelMap latitude={p.location.latitude} longitude={p.location.longitude} boundary={p.location.boundary} label={p.parcelId} />
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="history" className="mt-6">
        <TabsList className="flex-wrap">
          <TabsTrigger value="history">
            <Link2 /> History
          </TabsTrigger>
          <TabsTrigger value="encumbrances">
            <Landmark /> Mortgages
          </TabsTrigger>
          <TabsTrigger value="disputes">
            <TriangleAlert /> Disputes
          </TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          {!hasRole('BANK_OFFICER') && (
            <TabsTrigger value="transfers">
              <ArrowLeftRight /> Transfers
            </TabsTrigger>
          )}
        </TabsList>
        <TabsContent value="history" className="pt-4">
          <HistoryTab parcelId={p.parcelId} />
        </TabsContent>
        <TabsContent value="encumbrances" className="pt-4">
          <EncumbrancesTab parcelId={p.parcelId} />
        </TabsContent>
        <TabsContent value="disputes" className="pt-4">
          <DisputesTab parcelId={p.parcelId} />
        </TabsContent>
        <TabsContent value="documents" className="pt-4">
          <DocumentsTab parcelId={p.parcelId} />
        </TabsContent>
        <TabsContent value="transfers" className="pt-4">
          <TransfersTab parcelId={p.parcelId} />
        </TabsContent>
      </Tabs>
    </>
  );
}

function StateBanner({ p }: { p: Parcel }) {
  const notes: { tone: string; icon: typeof Snowflake; text: string }[] = [];
  if (p.retired) notes.push({ tone: 'var(--status-frozen)', icon: Archive, text: `Retired from the register${p.retiredReason ? `: ${p.retiredReason}` : ''}.` });
  if (p.frozen) notes.push({ tone: 'var(--status-frozen)', icon: Snowflake, text: `Frozen by the registry${p.frozenReason ? `: ${p.frozenReason}` : ''}. No transfers or mortgages until unfrozen.` });
  if (p.openDisputeIds.length) notes.push({ tone: 'var(--earth)', icon: TriangleAlert, text: `${p.openDisputeIds.length} open dispute(s). Transfers are blocked until resolved.` });
  if (p.activeEncumbranceIds.length) notes.push({ tone: 'var(--info)', icon: Landmark, text: `${p.activeEncumbranceIds.length} active mortgage(s)/charge(s). The bank must release before a transfer.` });
  if (p.activeTransferId)
    notes.push({ tone: 'var(--gold-ink)', icon: ArrowLeftRight, text: `Transfer ${p.activeTransferId} is in progress.` });
  if (!notes.length) return null;
  return (
    <div className="mb-4 space-y-2">
      {notes.map((n) => (
        <p
          key={n.text}
          className="flex items-start gap-2 rounded-lg border px-3 py-2 text-sm font-medium"
          style={{ borderColor: `color-mix(in oklab, ${n.tone} 35%, transparent)`, background: `color-mix(in oklab, ${n.tone} 9%, transparent)` }}
        >
          <n.icon className="mt-0.5 size-4 shrink-0" style={{ color: n.tone }} aria-hidden />
          {n.text.includes('Transfer TRF-') && p.activeTransferId ? (
            <span>
              Transfer{' '}
              <Link className="font-mono underline" href={`/transfers/${p.activeTransferId}`}>
                {p.activeTransferId}
              </Link>{' '}
              is in progress.
            </span>
          ) : (
            n.text
          )}
        </p>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------------------------------- actions
function ReasonField({ id, value, onChange, label = 'Reason', placeholder }: { id: string; value: string; onChange: (v: string) => void; label?: string; placeholder?: string }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Textarea id={id} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} rows={3} maxLength={500} />
      <p className="text-xs text-muted-foreground">Recorded on the ledger. Do not include personal data (names, NIDA, phone numbers).</p>
    </div>
  );
}

function FreezeToggle({ p, unfreeze, lock }: { p: Parcel; unfreeze?: boolean; lock: (open: boolean) => void }) {
  const [reason, setReason] = useState('');
  return (
    <ConfirmAction
      tier="T3"
      title={unfreeze ? 'Unfreeze parcel' : 'Freeze parcel'}
      trigger={
        <Button variant="outline">
          {unfreeze ? <Sun /> : <Snowflake />} {unfreeze ? 'Unfreeze' : 'Freeze'}
        </Button>
      }
      impactSentence={
        unfreeze ? (
          <>
            <span className="font-mono">{p.parcelId}</span> will be released — transfers and mortgages become possible again.
          </>
        ) : (
          <>
            <span className="font-mono">{p.parcelId}</span> will be frozen — no transfer or mortgage can proceed until it is unfrozen.
          </>
        )
      }
      canConfirm={reason.trim().length >= 3}
      successMessage={unfreeze ? 'Parcel unfrozen.' : 'Parcel frozen.'}
      onConfirm={(ctx) => ledgerWrite('post', `/parcels/${p.parcelId}/${unfreeze ? 'unfreeze' : 'freeze'}`, { reason }, ctx)}
      onOpenChange={(o) => {
        lock(o);
        if (o) setReason('');
      }}
    >
      <ReasonField id="freeze-reason" value={reason} onChange={setReason} placeholder={unfreeze ? 'e.g. Court order lifted' : 'e.g. Court injunction 12/2026'} />
    </ConfirmAction>
  );
}

function RetireParcel({ p, lock }: { p: Parcel; lock: (open: boolean) => void }) {
  const [reason, setReason] = useState('');
  const blocked = Boolean(p.activeTransferId || p.activeEncumbranceIds.length || p.openDisputeIds.length);
  return (
    <ConfirmAction
      tier="T3"
      title="Retire parcel"
      trigger={
        <Button variant="destructive" disabled={blocked} title={blocked ? 'Resolve active transfers, mortgages and disputes first' : undefined}>
          <Archive /> Retire
        </Button>
      }
      impactSentence={
        <>
          <span className="font-mono">{p.parcelId}</span> will be retired from the register permanently.
        </>
      }
      consequences={['The record and its full history are kept, but it can never be transferred or mortgaged again.', 'This cannot be undone.']}
      typeToConfirm={p.parcelId}
      canConfirm={reason.trim().length >= 3}
      successMessage="Parcel retired."
      onConfirm={(ctx) => ledgerWrite('post', `/parcels/${p.parcelId}/retire`, { reason }, ctx)}
      onOpenChange={(o) => {
        lock(o);
        if (o) setReason('');
      }}
    >
      <ReasonField id="retire-reason" value={reason} onChange={setReason} placeholder="e.g. Merged into DSM-KIN-12-50" />
    </ConfirmAction>
  );
}

function EditParcel({ p, lock }: { p: Parcel; lock: (open: boolean) => void }) {
  const [landUse, setLandUse] = useState<string>(p.landUse);
  const [area, setArea] = useState(String(p.area));
  const [reason, setReason] = useState('');
  const [lat, setLat] = useState(String(p.location.latitude));
  const [lng, setLng] = useState(String(p.location.longitude));

  const areaNum = Number(area);
  const areaChanged = area !== '' && areaNum !== p.area;
  const locChanged = Number(lat) !== p.location.latitude || Number(lng) !== p.location.longitude;
  const body: Record<string, unknown> = {};
  if (landUse !== p.landUse) body.landUse = landUse;
  if (areaChanged) {
    body.area = areaNum;
    body.areaCorrectionReason = reason.trim();
  }
  if (locChanged) body.location = { latitude: Number(lat), longitude: Number(lng), boundary: p.location.boundary, address: p.location.address };
  const valid =
    Object.keys(body).length > 0 && (!areaChanged || (areaNum > 0 && reason.trim().length >= 3)) && (!locChanged || (Math.abs(Number(lat)) <= 90 && Math.abs(Number(lng)) <= 180));

  const impact = [
    ...(body.landUse ? [{ label: 'Land use', value: `${titleCase(p.landUse)} → ${titleCase(landUse)}` }] : []),
    ...(areaChanged ? [{ label: 'Area', value: `${fmtArea(p.area)} → ${fmtArea(areaNum)}` }] : []),
    ...(locChanged ? [{ label: 'Location', value: `${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}`, mono: true }] : []),
  ];

  return (
    <ConfirmAction
      tier="T3"
      title="Update parcel details"
      description="Only land use, area (with a correction reason) and location can change. Ownership changes only through a transfer."
      trigger={
        <Button variant="outline">
          <Pencil /> Edit
        </Button>
      }
      impact={impact}
      canConfirm={valid}
      successMessage="Parcel details updated."
      onConfirm={(ctx) => ledgerWrite('patch', `/parcels/${p.parcelId}`, body, ctx)}
      onOpenChange={(o) => {
        lock(o);
        if (!o) return;
        setLandUse(p.landUse);
        setArea(String(p.area));
        setReason('');
        setLat(String(p.location.latitude));
        setLng(String(p.location.longitude));
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="edit-landuse">Land use</Label>
          <Select value={landUse} onValueChange={setLandUse}>
            <SelectTrigger id="edit-landuse" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LAND_USES.map((u) => (
                <SelectItem key={u} value={u}>
                  {titleCase(u)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="edit-area">Area (m²)</Label>
          <Input id="edit-area" type="number" min={1} step="0.01" value={area} onChange={(e) => setArea(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="edit-lat">Latitude</Label>
          <Input id="edit-lat" type="number" step="0.00001" value={lat} onChange={(e) => setLat(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="edit-lng">Longitude</Label>
          <Input id="edit-lng" type="number" step="0.00001" value={lng} onChange={(e) => setLng(e.target.value)} />
        </div>
      </div>
      {areaChanged && <ReasonField id="edit-reason" label="Area correction reason" value={reason} onChange={setReason} placeholder="e.g. Resurvey by District Surveyor, March 2026" />}
    </ConfirmAction>
  );
}

const CATEGORIES = ['OWNERSHIP', 'BOUNDARY', 'INHERITANCE', 'FRAUD', 'COURT_ORDER', 'OTHER'] as const;

function FlagDispute({ p, lock }: { p: Parcel; lock: (open: boolean) => void }) {
  const [category, setCategory] = useState<string>('BOUNDARY');
  const [summary, setSummary] = useState('');
  return (
    <ConfirmAction
      tier="T3"
      title="Flag a dispute"
      trigger={
        <Button variant="outline" className="border-earth/50 text-earth hover:bg-earth/10 hover:text-earth">
          <TriangleAlert /> Flag dispute
        </Button>
      }
      impactSentence={
        <>
          <span className="font-mono">{p.parcelId}</span> will be marked <strong>Disputed</strong>. Any transfer in progress stops until the dispute is resolved.
        </>
      }
      canConfirm={summary.trim().length >= 10}
      successMessage="Dispute flagged."
      onConfirm={(ctx) => ledgerWrite('post', `/parcels/${p.parcelId}/disputes`, { category, summary }, ctx)}
      onOpenChange={(o) => {
        lock(o);
        if (o) setSummary('');
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="dispute-cat">Category</Label>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger id="dispute-cat" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CATEGORIES.map((c) => (
              <SelectItem key={c} value={c}>
                {titleCase(c)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <ReasonField id="dispute-summary" label="Summary (at least 10 characters)" value={summary} onChange={setSummary} placeholder="e.g. Neighbour contests the eastern boundary beacon" />
    </ConfirmAction>
  );
}

// ---------------------------------------------------------------------------------------------- tabs
function TabLoading() {
  return (
    <div className="space-y-3">
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-16" />
      ))}
    </div>
  );
}

function HistoryTab({ parcelId }: { parcelId: string }) {
  const h = useParcelHistory(parcelId);
  if (h.isError) return <ErrorState error={h.error} onRetry={() => void h.refetch()} />;
  if (!h.data) return <TabLoading />;
  return <OwnershipChain entries={h.data} />;
}

function EncumbrancesTab({ parcelId }: { parcelId: string }) {
  const q = useParcelEncumbrances(parcelId);
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data) return <TabLoading />;
  if (!q.data.length) return <EmptyState icon={<Landmark className="size-6" />} title="No mortgages or charges" description="Banks register encumbrances through the partner API or the portal." />;
  return (
    <ul className="space-y-3">
      {q.data.map((e) => (
        <li key={e.encumbranceId} className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-4">
          <span className="grid size-10 place-items-center rounded-lg bg-info/10 text-info">
            <Landmark className="size-5" aria-hidden />
          </span>
          <div className="flex-1">
            <p className="font-semibold">
              {titleCase(e.type)} · {e.lenderName}
            </p>
            <p className="text-sm text-muted-foreground">
              {fmtMoney(e.amount, e.currency)} · ref {e.reference} · since {fmtDate(e.createdAt)}
            </p>
          </div>
          <Badge variant={e.status === 'ACTIVE' ? 'default' : 'secondary'}>{e.status === 'ACTIVE' ? 'Active' : `Released ${fmtDate(e.releasedAt)}`}</Badge>
        </li>
      ))}
    </ul>
  );
}

function DisputesTab({ parcelId }: { parcelId: string }) {
  const q = useParcelDisputes(parcelId);
  const { hasRole } = useAuth();
  const canAct = hasRole('LAND_OFFICER', 'REGISTRAR');
  // Keep a dispute's actions mounted while its dialog is open, even after the commit marks it RESOLVED.
  const [lockedId, setLockedId] = useState<string | null>(null);
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data) return <TabLoading />;
  if (!q.data.length) return <EmptyState icon={<TriangleAlert className="size-6" />} title="No disputes" description="Land officers flag disputes; transfers stop while one is open." />;
  return (
    <ul className="space-y-3">
      {q.data.map((d) => (
        <li key={d.disputeId} className="rounded-xl border bg-card p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={d.status === 'OPEN' ? 'destructive' : 'secondary'}>{d.status === 'OPEN' ? 'Open' : 'Resolved'}</Badge>
            <span className="font-semibold">{titleCase(d.category)}</span>
            <span className="font-mono text-xs text-muted-foreground">{d.disputeId}</span>
            <span className="ml-auto text-xs text-muted-foreground">{fmtDate(d.createdAt)}</span>
          </div>
          <p className="mt-2 text-sm">{d.summary}</p>
          {d.notes.length > 0 && (
            <ul className="mt-3 space-y-1 border-l-2 pl-3">
              {d.notes.map((n) => (
                <li key={n.txId} className="text-sm">
                  <span className="text-muted-foreground">
                    {fmtDate(n.at)} · {ROLE_LABEL[n.by.role ?? '']}:
                  </span>{' '}
                  {n.text}
                </li>
              ))}
            </ul>
          )}
          {d.resolution && <p className="mt-3 rounded-md bg-success/10 px-3 py-2 text-sm">Resolution: {d.resolution}</p>}
          {canAct && (d.status === 'OPEN' || lockedId === d.disputeId) && (
            <div className="mt-3 flex gap-2">
              <DisputeAction disputeId={d.disputeId} kind="note" lock={(o) => setLockedId(o ? d.disputeId : null)} />
              <DisputeAction disputeId={d.disputeId} kind="resolve" lock={(o) => setLockedId(o ? d.disputeId : null)} />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

function DisputeAction({ disputeId, kind, lock }: { disputeId: string; kind: 'note' | 'resolve'; lock: (open: boolean) => void }) {
  const [text, setText] = useState('');
  return (
    <ConfirmAction
      tier="T3"
      title={kind === 'note' ? 'Add a note to the dispute' : 'Resolve dispute'}
      trigger={
        <Button size="sm" variant={kind === 'note' ? 'outline' : 'default'}>
          {kind === 'note' ? 'Add note' : 'Resolve'}
        </Button>
      }
      impactSentence={kind === 'resolve' ? 'The dispute will be closed. If no other dispute is open, transfers become possible again.' : 'The note will be added to the dispute record on the ledger.'}
      canConfirm={text.trim().length >= 3}
      successMessage={kind === 'note' ? 'Note added.' : 'Dispute resolved.'}
      onConfirm={(ctx) => ledgerWrite('post', `/disputes/${disputeId}/${kind === 'note' ? 'notes' : 'resolve'}`, kind === 'note' ? { note: text } : { resolution: text }, ctx)}
      onOpenChange={(o) => {
        lock(o);
        if (o) setText('');
      }}
    >
      <ReasonField id={`dispute-${kind}`} label={kind === 'note' ? 'Note' : 'Resolution'} value={text} onChange={setText} />
    </ConfirmAction>
  );
}

function DocumentsTab({ parcelId }: { parcelId: string }) {
  const q = useParcelDocuments(parcelId);
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data) return <TabLoading />;
  return <DocumentList documents={q.data} />;
}

function TransfersTab({ parcelId }: { parcelId: string }) {
  const q = useParcelTransfers(parcelId);
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data) return <TabLoading />;
  if (!q.data.length) return <EmptyState icon={<ArrowLeftRight className="size-6" />} title="No transfers yet" />;
  return (
    <ul className="divide-y rounded-xl border bg-card">
      {[...q.data].reverse().map((t) => (
        <li key={t.transferId}>
          <Link href={`/transfers/${t.transferId}`} className="flex flex-wrap items-center gap-3 p-4 hover:bg-accent/50">
            <span className="font-mono text-sm font-semibold">{t.transferId}</span>
            <StatusBadge kind="transfer" status={t.status} size="sm" />
            <span className="ml-auto text-sm text-muted-foreground">{fmtDate(t.createdAt)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
