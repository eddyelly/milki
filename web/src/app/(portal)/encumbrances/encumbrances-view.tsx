'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { Landmark, Search } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { type coreFeatures, DataTable, Pagination } from '@/components/data-table';
import { EmptyState, ErrorState, PageHeader } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { type EncumbranceRow, useEncumbranceBook } from '@/lib/admin';
import { useAuth } from '@/lib/auth';
import { fmtAgo, fmtDate, fmtMoney, titleCase } from '@/lib/format';

const columns: ColumnDef<typeof coreFeatures, EncumbranceRow>[] = [
  { id: 'id', header: 'Encumbrance', cell: ({ row }) => <span className="font-mono text-xs font-semibold">{row.original.encumbranceId}</span> },
  {
    id: 'parcel',
    header: 'Parcel',
    cell: ({ row }) => (
      <Link href={`/parcels/${row.original.parcelId}`} className="font-mono text-sm text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
        {row.original.parcelId}
      </Link>
    ),
  },
  { id: 'type', header: 'Type', cell: ({ row }) => <span className="text-sm">{titleCase(row.original.type)}</span> },
  { id: 'lender', header: 'Lender', cell: ({ row }) => <span className="text-sm">{row.original.lenderName}</span> },
  { id: 'amount', header: 'Amount', cell: ({ row }) => <span className="text-sm tabular-nums">{fmtMoney(row.original.amount, row.original.currency)}</span> },
  { id: 'ref', header: 'Reference', cell: ({ row }) => <span className="font-mono text-xs">{row.original.reference}</span> },
  {
    id: 'status',
    header: 'Status',
    cell: ({ row }) => (row.original.status === 'ACTIVE' ? <Badge className="bg-info/15 text-info">Active</Badge> : <Badge variant="secondary">Released {fmtDate(row.original.releasedAt)}</Badge>),
  },
  { id: 'updated', header: 'Updated', cell: ({ row }) => <span className="text-sm text-muted-foreground">{fmtAgo(row.original.ledgerUpdatedAt)}</span> },
];

/** Bank officers see their own book; registry staff see every bank's. Add / update / release happen on the parcel page (T3). */
export function EncumbrancesView() {
  const { user } = useAuth();
  const router = useRouter();
  const [status, setStatus] = useState('ACTIVE');
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [page, setPage] = useState(1);
  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(q.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);
  const book = useEncumbranceBook({ status: status === 'ALL' ? undefined : status, q: debounced, page, limit: 20 });
  const bank = user?.role === 'BANK_OFFICER';
  return (
    <>
      <PageHeader
        title={bank ? `${user?.bankName ?? 'Bank'} mortgages & charges` : 'Encumbrances'}
        description={bank ? 'Your bank’s encumbrances on the land register. Open a parcel to register a new one.' : 'Every bank’s encumbrances on the register.'}
      />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Tabs value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
          <TabsList>
            <TabsTrigger value="ACTIVE">Active</TabsTrigger>
            <TabsTrigger value="RELEASED">Released</TabsTrigger>
            <TabsTrigger value="ALL">All</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="relative sm:w-72">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Parcel ID or loan reference" className="bg-card pl-9" aria-label="Search encumbrances" />
        </div>
      </div>
      {book.isError ? (
        <ErrorState error={book.error} onRetry={() => void book.refetch()} />
      ) : (
        <>
          <DataTable
            columns={columns}
            data={book.data?.items}
            loading={book.isLoading}
            onRowClick={(e) => router.push(`/parcels/${e.parcelId}`)}
            rowLabel={(e) => `Open parcel ${e.parcelId}`}
            empty={<EmptyState icon={<Landmark className="size-6" />} title="No encumbrances here" description={bank ? 'Search a parcel and use “Add mortgage / charge” to register one.' : undefined} />}
          />
          <Pagination meta={book.data?.meta} onPage={setPage} />
        </>
      )}
    </>
  );
}
