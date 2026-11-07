'use client';

import { type ColumnDef, type RowData, tableFeatures, useTable } from '@tanstack/react-table';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { PageMeta } from '@/lib/types';

/** Server-paginated/sorted data, so only the core row model is needed (TanStack Table v9). */
export const coreFeatures = tableFeatures({});

/**
 * Plain, non-animated table (CLAUDE.md §10: never animate tables people read all day).
 * Loading → skeleton rows; empty → `empty`; rows are keyboard-reachable when `onRowClick` is set.
 */
export function DataTable<T extends RowData>({
  columns,
  data,
  loading,
  empty,
  onRowClick,
  rowLabel,
}: {
  columns: ColumnDef<typeof coreFeatures, T>[];
  data: T[] | undefined;
  loading?: boolean;
  empty: ReactNode;
  onRowClick?: (row: T) => void;
  rowLabel?: (row: T) => string;
}) {
  const table = useTable({ features: coreFeatures, columns, data: data ?? EMPTY });
  if (!loading && data && data.length === 0) return <>{empty}</>;

  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <Table>
        <TableHeader className="bg-muted/50">
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id} className="hover:bg-transparent">
              {group.headers.map((header) => (
                <TableHead key={header.id} className="h-10 text-xs font-semibold text-muted-foreground">
                  {header.isPlaceholder ? null : <table.FlexRender header={header} />}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {loading && !data
            ? Array.from({ length: 6 }, (_, i) => (
                <TableRow key={i}>
                  {columns.map((_c, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-4 w-full max-w-36" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            : table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  tabIndex={onRowClick ? 0 : undefined}
                  aria-label={rowLabel?.(row.original)}
                  onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                  onKeyDown={onRowClick ? (e) => e.key === 'Enter' && onRowClick(row.original) : undefined}
                  className={onRowClick ? 'cursor-pointer focus-visible:bg-accent focus-visible:outline-none' : undefined}
                >
                  {row.getAllCells().map((cell) => (
                    <TableCell key={cell.id} className="py-3">
                      <table.FlexRender cell={cell} />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
        </TableBody>
      </Table>
    </div>
  );
}

const EMPTY: never[] = [];

export function Pagination({ meta, onPage }: { meta: PageMeta | undefined; onPage: (p: number) => void }) {
  if (!meta || meta.total === 0) return null;
  const from = (meta.page - 1) * meta.limit + 1;
  const to = Math.min(meta.total, meta.page * meta.limit);
  return (
    <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
      <span>
        {from}–{to} of {meta.total.toLocaleString('en')}
      </span>
      <div className="flex gap-1">
        <Button variant="outline" size="sm" disabled={meta.page <= 1} onClick={() => onPage(meta.page - 1)} aria-label="Previous page">
          <ChevronLeft /> Prev
        </Button>
        <Button variant="outline" size="sm" disabled={meta.page >= meta.pages} onClick={() => onPage(meta.page + 1)} aria-label="Next page">
          Next <ChevronRight />
        </Button>
      </div>
    </div>
  );
}
