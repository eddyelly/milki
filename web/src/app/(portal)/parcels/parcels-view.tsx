'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { FilePlus2, MapPinned, Search } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { type coreFeatures, DataTable, Pagination } from '@/components/data-table';
import { EmptyState, ErrorState, PageHeader } from '@/components/page';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/lib/auth';
import { fmtAgo, fmtArea, titleCase } from '@/lib/format';
import { useParcels } from '@/lib/queries';
import { PARCEL_STATUS } from '@/lib/status';
import { LAND_USES, PARCEL_STATUSES, type ParcelSummary } from '@/lib/types';

const columns: ColumnDef<typeof coreFeatures, ParcelSummary>[] = [
  {
    id: 'parcelId',
    header: 'Parcel',
    cell: ({ row }) => (
      <div>
        <Link href={`/parcels/${row.original.parcelId}`} className="font-mono text-sm font-semibold text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
          {row.original.parcelId}
        </Link>
        <p className="font-mono text-xs text-muted-foreground">{row.original.titleNumber}</p>
      </div>
    ),
  },
  {
    id: 'location',
    header: 'Location',
    cell: ({ row }) => (
      <div className="min-w-40">
        <p className="text-sm">{row.original.ward}</p>
        <p className="text-xs text-muted-foreground">
          {row.original.district}, {row.original.region}
        </p>
      </div>
    ),
  },
  { id: 'area', header: 'Area', cell: ({ row }) => <span className="tabular-nums">{fmtArea(row.original.area)}</span> },
  { id: 'landUse', header: 'Land use', cell: ({ row }) => titleCase(row.original.landUse) },
  { id: 'status', header: 'Status', cell: ({ row }) => <StatusBadge kind="parcel" status={row.original.status} size="sm" /> },
  { id: 'updated', header: 'Updated', cell: ({ row }) => <span className="text-sm text-muted-foreground">{fmtAgo(row.original.ledgerUpdatedAt)}</span> },
];

export function ParcelsView() {
  return (
    <Suspense>
      <Parcels />
    </Suspense>
  );
}

function Parcels() {
  const router = useRouter();
  const params = useSearchParams();
  const { hasRole } = useAuth();
  const [q, setQ] = useState(params.get('q') ?? '');
  const [debounced, setDebounced] = useState(q);
  const [status, setStatus] = useState(params.get('status') ?? 'ALL');
  const [landUse, setLandUse] = useState('ALL');
  const [page, setPage] = useState(1);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(q);
      setPage(1);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const query = useParcels({
    page,
    limit: 20,
    q: debounced,
    status: status === 'ALL' ? undefined : status,
    landUse: landUse === 'ALL' ? undefined : landUse,
    sort: '-updatedAt',
  });

  const filtered = Boolean(debounced) || status !== 'ALL' || landUse !== 'ALL';

  return (
    <>
      <PageHeader
        title="Parcels"
        description="Search the register. Lists come from the live cache; opening a parcel reads it straight from the ledger."
        actions={
          hasRole('REGISTRAR') && (
            <Button asChild>
              <Link href="/parcels/new">
                <FilePlus2 /> Register parcel
              </Link>
            </Button>
          )
        }
      />
      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Parcel ID, title number, region, district or ward" className="bg-card pl-9" aria-label="Search parcels" />
        </div>
        <Select
          value={status}
          onValueChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-full bg-card sm:w-48" aria-label="Filter by status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All statuses</SelectItem>
            {PARCEL_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {PARCEL_STATUS[s].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={landUse}
          onValueChange={(v) => {
            setLandUse(v);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-full bg-card sm:w-44" aria-label="Filter by land use">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All land uses</SelectItem>
            {LAND_USES.map((u) => (
              <SelectItem key={u} value={u}>
                {titleCase(u)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <>
          <DataTable
            columns={columns}
            data={query.data?.items}
            loading={query.isLoading}
            onRowClick={(p) => router.push(`/parcels/${p.parcelId}`)}
            rowLabel={(p) => `Open parcel ${p.parcelId}`}
            empty={
              <EmptyState
                icon={<MapPinned className="size-6" />}
                title={filtered ? 'No parcels match these filters' : 'No parcels registered yet'}
                description={filtered ? 'Try a different search or clear the filters.' : 'Registered parcels appear here as soon as the ledger commits them.'}
                action={
                  filtered ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setQ('');
                        setStatus('ALL');
                        setLandUse('ALL');
                      }}
                    >
                      Clear filters
                    </Button>
                  ) : undefined
                }
              />
            }
          />
          <Pagination meta={query.data?.meta} onPage={setPage} />
        </>
      )}
    </>
  );
}
