'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { ArrowLeftRight, Search } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { type coreFeatures, DataTable, Pagination } from '@/components/data-table';
import { EmptyState, ErrorState, PageHeader } from '@/components/page';
import { StatusBadge } from '@/components/status-badge';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/lib/auth';
import { fmtAgo, fmtDate } from '@/lib/format';
import { useOverview, useTransfers } from '@/lib/queries';
import type { Role, TransferSummary } from '@/lib/types';

const columns: ColumnDef<typeof coreFeatures, TransferSummary>[] = [
  {
    id: 'transfer',
    header: 'Transfer',
    cell: ({ row }) => (
      <Link href={`/transfers/${row.original.transferId}`} className="font-mono text-sm font-semibold text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
        {row.original.transferId}
      </Link>
    ),
  },
  {
    id: 'parcel',
    header: 'Parcel',
    cell: ({ row }) => (
      <Link href={`/parcels/${row.original.parcelId}`} className="font-mono text-sm hover:underline" onClick={(e) => e.stopPropagation()}>
        {row.original.parcelId}
      </Link>
    ),
  },
  { id: 'status', header: 'Status', cell: ({ row }) => <StatusBadge kind="transfer" status={row.original.status} size="sm" /> },
  { id: 'started', header: 'Started', cell: ({ row }) => <span className="text-sm">{fmtDate(row.original.ledgerCreatedAt)}</span> },
  { id: 'updated', header: 'Last step', cell: ({ row }) => <span className="text-sm text-muted-foreground">{fmtAgo(row.original.ledgerUpdatedAt)}</span> },
];

interface QueueTab {
  key: string;
  label: string;
  status?: string;
  count?: (o: NonNullable<ReturnType<typeof useOverview>['data']>) => number;
}

/** Each role lands on the queue it acts on (CLAUDE.md §2). */
function tabsFor(role: Role | undefined): QueueTab[] {
  const all: QueueTab = { key: 'all', label: 'All transfers' };
  const open: QueueTab = { key: 'open', label: 'In progress', status: 'INITIATED,BUYER_ACCEPTED,PAYMENTS_CONFIRMED,OFFICER_VERIFIED' };
  const closed: QueueTab = { key: 'closed', label: 'Closed', status: 'COMPLETED,CANCELLED,REJECTED' };
  if (role === 'LAND_OFFICER')
    return [
      { key: 'payments', label: 'Confirm payments', status: 'BUYER_ACCEPTED', count: (o) => o.queues.awaitingPayments },
      { key: 'verify', label: 'Verify', status: 'PAYMENTS_CONFIRMED', count: (o) => o.queues.awaitingVerification },
      open,
      all,
    ];
  if (role === 'REGISTRAR') return [{ key: 'approve', label: 'Approve', status: 'OFFICER_VERIFIED', count: (o) => o.queues.awaitingApproval }, open, closed, all];
  return [open, closed, all];
}

export function TransfersView() {
  return (
    <Suspense>
      <Transfers />
    </Suspense>
  );
}

function Transfers() {
  const { user } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const overview = useOverview();
  const tabs = tabsFor(user?.role);
  const initial = tabs.find((t) => t.status === params.get('status'))?.key ?? tabs[0]?.key ?? 'all';
  const [tab, setTab] = useState(initial);
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(q);
      setPage(1);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const current = tabs.find((t) => t.key === tab);
  const query = useTransfers({ page, limit: 20, q: debounced, status: current?.status, sort: tab === 'all' || tab === 'closed' ? '-updatedAt' : 'updatedAt' });

  return (
    <>
      <PageHeader title="Transfers" description="Work queue, oldest first in action tabs so nothing waits too long." />
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <Tabs
          value={tab}
          onValueChange={(v) => {
            setTab(v);
            setPage(1);
          }}
        >
          <TabsList className="flex-wrap">
            {tabs.map((t) => {
              const n = t.count && overview.data ? t.count(overview.data) : 0;
              return (
                <TabsTrigger key={t.key} value={t.key}>
                  {t.label}
                  {n > 0 && <span className="ml-1 rounded-full bg-gold px-1.5 font-mono text-[11px] text-ink">{n}</span>}
                </TabsTrigger>
              );
            })}
          </TabsList>
        </Tabs>
        <div className="relative lg:w-80">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Transfer or parcel ID" className="bg-card pl-9" aria-label="Search transfers" />
        </div>
      </div>
      {query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <>
          <DataTable
            columns={columns}
            data={query.data?.items}
            loading={query.isLoading}
            onRowClick={(t) => router.push(`/transfers/${t.transferId}`)}
            rowLabel={(t) => `Open transfer ${t.transferId}`}
            empty={
              <EmptyState
                icon={<ArrowLeftRight className="size-6" />}
                title={current?.count ? 'Queue is clear' : 'No transfers here'}
                description={current?.count ? 'Nothing is waiting for you. New work appears here live.' : 'Transfers appear once a landowner starts one in the mobile app.'}
              />
            }
          />
          <Pagination meta={query.data?.meta} onPage={setPage} />
        </>
      )}
    </>
  );
}
