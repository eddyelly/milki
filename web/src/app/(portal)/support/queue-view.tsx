'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { Headset, MessageSquareText, Search } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { type coreFeatures, DataTable, Pagination } from '@/components/data-table';
import { EmptyState, ErrorState, PageHeader } from '@/components/page';
import { StatusBadge } from '@/components/status-badge';
import { PresenceDot, PriorityBadge, SlaTimer } from '@/components/support/sla';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { fmtAgo } from '@/lib/format';
import { CATEGORY_LABEL, PRIORITY, TICKET_CATEGORIES, TICKET_PRIORITIES, type Ticket, useQueueLive, useSupportPresence, useTickets } from '@/lib/support';

const OPEN = 'OPEN,IN_PROGRESS,AWAITING_USER';

const TABS = [
  { key: 'mine', label: 'My tickets', params: { assignee: 'me', status: OPEN } },
  { key: 'unassigned', label: 'Unassigned', params: { assignee: 'unassigned', status: OPEN } },
  { key: 'open', label: 'All open', params: { status: OPEN } },
  { key: 'awaiting', label: 'Awaiting user', params: { status: 'AWAITING_USER' } },
  { key: 'done', label: 'Resolved & closed', params: { status: 'RESOLVED,CLOSED' } },
] as const;

const columns: ColumnDef<typeof coreFeatures, Ticket>[] = [
  {
    id: 'ticket',
    header: 'Ticket',
    cell: ({ row }) => (
      <div className="min-w-0 max-w-[22rem]">
        <Link href={`/support/${row.original.id}`} className="font-mono text-xs font-semibold text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
          {row.original.number}
        </Link>
        <p className="truncate text-sm font-medium">{row.original.subject}</p>
      </div>
    ),
  },
  { id: 'requester', header: 'Requester', cell: ({ row }) => <span className="text-sm">{row.original.requester ?? '—'}</span> },
  { id: 'category', header: 'Category', cell: ({ row }) => <span className="text-sm text-muted-foreground">{CATEGORY_LABEL[row.original.category]}</span> },
  { id: 'priority', header: 'Priority', cell: ({ row }) => <PriorityBadge priority={row.original.priority} /> },
  { id: 'status', header: 'Status', cell: ({ row }) => <StatusBadge kind="ticket" status={row.original.status} size="sm" /> },
  { id: 'sla', header: 'SLA', cell: ({ row }) => <SlaTimer sla={row.original.sla} start={row.original.createdAt} className="w-40" /> },
  { id: 'assignee', header: 'Assignee', cell: ({ row }) => <span className="text-sm">{row.original.assignee ?? <span className="text-muted-foreground">Unassigned</span>}</span> },
  { id: 'activity', header: 'Last activity', cell: ({ row }) => <span className="text-sm text-muted-foreground">{fmtAgo(row.original.lastMessageAt)}</span> },
];

export function SupportQueueView() {
  const router = useRouter();
  const presence = useSupportPresence();
  useQueueLive();
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('mine');
  const [priority, setPriority] = useState('ALL');
  const [category, setCategory] = useState('ALL');
  const [sort, setSort] = useState('sla');
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

  const current = TABS.find((t) => t.key === tab)!;
  const query = useTickets({
    ...current.params,
    page,
    limit: 20,
    q: debounced,
    priority: priority === 'ALL' ? undefined : priority,
    category: category === 'ALL' ? undefined : category,
    sort: tab === 'done' ? '-updatedAt' : sort,
  });

  return (
    <>
      <PageHeader
        title="Support queue"
        description="Tickets and live chat from landowners. Oldest SLA first, so nobody waits too long."
        actions={
          <>
            <PresenceDot count={presence} className="mr-2 self-center" />
            <Button variant="outline" asChild>
              <Link href="/support/canned">
                <MessageSquareText /> Canned responses
              </Link>
            </Button>
          </>
        }
      />
      <div className="mb-4 flex flex-col gap-3">
        <Tabs
          value={tab}
          onValueChange={(v) => {
            setTab(v as typeof tab);
            setPage(1);
          }}
        >
          <TabsList className="flex-wrap">
            {TABS.map((t) => (
              <TabsTrigger key={t.key} value={t.key}>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <div className="relative sm:w-72">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ticket number, subject, parcel…" className="bg-card pl-9" aria-label="Search tickets" />
          </div>
          <Select value={priority} onValueChange={(v) => { setPriority(v); setPage(1); }}>
            <SelectTrigger className="bg-card sm:w-40" aria-label="Priority">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All priorities</SelectItem>
              {TICKET_PRIORITIES.map((p) => (
                <SelectItem key={p} value={p}>
                  {PRIORITY[p].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={category} onValueChange={(v) => { setCategory(v); setPage(1); }}>
            <SelectTrigger className="bg-card sm:w-44" aria-label="Category">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All categories</SelectItem>
              {TICKET_CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>
                  {CATEGORY_LABEL[c]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {tab !== 'done' && (
            <Select value={sort} onValueChange={setSort}>
              <SelectTrigger className="bg-card sm:w-48" aria-label="Sort">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sla">SLA due first</SelectItem>
                <SelectItem value="priority">Priority</SelectItem>
                <SelectItem value="-lastMessageAt">Latest activity</SelectItem>
                <SelectItem value="-createdAt">Newest</SelectItem>
              </SelectContent>
            </Select>
          )}
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
            onRowClick={(t) => router.push(`/support/${t.id}`)}
            rowLabel={(t) => `Open ticket ${t.number}`}
            empty={
              <EmptyState
                icon={<Headset className="size-6" />}
                title={tab === 'mine' ? 'Nothing assigned to you' : 'No tickets here'}
                description={tab === 'mine' ? 'Claim one from Unassigned, or wait — new tickets appear live.' : 'Try another tab or clear the filters.'}
              />
            }
          />
          <Pagination meta={query.data?.meta} onPage={setPage} />
        </>
      )}
    </>
  );
}
