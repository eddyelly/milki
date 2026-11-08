'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { ScrollText, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { type coreFeatures, DataTable, Pagination } from '@/components/data-table';
import { EmptyState, ErrorState, PageHeader } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { type AuditRow, useAuditLog } from '@/lib/admin';
import { fmtDateTime, ROLE_LABEL, shortHash } from '@/lib/format';

const AREAS = [
  { value: 'ALL', label: 'Everything' },
  { value: 'ledger.', label: 'Ledger events' },
  { value: 'transfer.', label: 'Transfers' },
  { value: 'parcel.', label: 'Parcels' },
  { value: 'document.', label: 'Documents' },
  { value: 'encumbrance.', label: 'Encumbrances' },
  { value: 'auth.', label: 'Sign-in & re-auth' },
  { value: 'admin.', label: 'Admin' },
  { value: 'support.', label: 'Support' },
  { value: 'kb.', label: 'Help centre' },
  { value: 'partner.', label: 'Partner API' },
];

/** Read-only, append-only (CLAUDE.md §7.2). Tables are never animated (§10). */
const columns: ColumnDef<typeof coreFeatures, AuditRow>[] = [
  { id: 'at', header: 'When', cell: ({ row }) => <span className="text-sm whitespace-nowrap">{fmtDateTime(row.original.at)}</span> },
  { id: 'action', header: 'Action', cell: ({ row }) => <span className="font-mono text-xs">{row.original.action}</span> },
  {
    id: 'actor',
    header: 'Actor',
    cell: ({ row }) => (
      <div className="min-w-0">
        <p className="text-sm">{row.original.actorName ?? row.original.actor?.userId ?? 'System'}</p>
        {row.original.actor?.role && <p className="text-xs text-muted-foreground">{ROLE_LABEL[row.original.actor.role] ?? row.original.actor.role}</p>}
      </div>
    ),
  },
  {
    id: 'entity',
    header: 'Record',
    cell: ({ row }) => (
      <span className="text-sm">
        {row.original.entityType} <span className="font-mono text-xs">{row.original.entityId}</span>
      </span>
    ),
  },
  { id: 'tx', header: 'Ledger tx', cell: ({ row }) => <span className="font-mono text-xs text-muted-foreground">{row.original.txId ? shortHash(row.original.txId) : '—'}</span> },
  {
    id: 'outcome',
    header: 'Outcome',
    cell: ({ row }) => (row.original.outcome === 'SUCCESS' ? <Badge className="bg-success/15 text-success">Success</Badge> : <Badge className="bg-destructive/12 text-destructive">Failure</Badge>),
  },
];

export function AuditView() {
  const [area, setArea] = useState('ALL');
  const [outcome, setOutcome] = useState('ALL');
  const [entity, setEntity] = useState('');
  const [debounced, setDebounced] = useState('');
  const [page, setPage] = useState(1);
  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(entity.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [entity]);
  const log = useAuditLog({ action: area, outcome, entityId: debounced, page, limit: 50 });
  return (
    <>
      <PageHeader title="Audit log" description="Every mutation and partner API call, newest first. Read-only — entries can never be changed or deleted." />
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <Select value={area} onValueChange={(v) => { setArea(v); setPage(1); }}>
          <SelectTrigger className="bg-card sm:w-52" aria-label="Area">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {AREAS.map((a) => (
              <SelectItem key={a.value} value={a.value}>
                {a.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={outcome} onValueChange={(v) => { setOutcome(v); setPage(1); }}>
          <SelectTrigger className="bg-card sm:w-40" aria-label="Outcome">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Any outcome</SelectItem>
            <SelectItem value="SUCCESS">Success</SelectItem>
            <SelectItem value="FAILURE">Failure</SelectItem>
          </SelectContent>
        </Select>
        <div className="relative sm:w-72">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={entity} onChange={(e) => setEntity(e.target.value)} placeholder="Record ID, e.g. TRF-… or usr_…" className="bg-card pl-9 font-mono text-sm" aria-label="Record ID" />
        </div>
      </div>
      {log.isError ? (
        <ErrorState error={log.error} onRetry={() => void log.refetch()} />
      ) : (
        <>
          <DataTable columns={columns} data={log.data?.items} loading={log.isLoading} rowLabel={(r) => r.action} empty={<EmptyState icon={<ScrollText className="size-6" />} title="No entries match" />} />
          <Pagination meta={log.data?.meta} onPage={setPage} />
        </>
      )}
    </>
  );
}
