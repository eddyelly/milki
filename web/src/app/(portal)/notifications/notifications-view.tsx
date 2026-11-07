'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCheck, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { ConfirmAction } from '@/components/confirm-action';
import { Pagination } from '@/components/data-table';
import { EmptyState, ErrorState, PageHeader } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { http, send } from '@/lib/api';
import { fmtAgo } from '@/lib/format';
import { useNotifications } from '@/lib/queries';
import { cn } from '@/lib/utils';

export function NotificationsView() {
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [page, setPage] = useState(1);
  const q = useNotifications({ page, limit: 20, ...(filter === 'unread' ? { unread: 'true' as const } : {}) });
  const qc = useQueryClient();
  const refresh = () => void qc.invalidateQueries({ queryKey: ['notifications'] });
  // Read receipts are UI state (no confirmation); deleting is a T1 confirmation.
  const markAll = useMutation({ mutationFn: () => http.post('/notifications/read-all', {}), onSuccess: refresh });
  const markOne = useMutation({ mutationFn: (id: string) => http.post(`/notifications/${id}/read`, {}), onSuccess: refresh });

  return (
    <>
      <PageHeader
        title="Notifications"
        description="Updates from the ledger about parcels and transfers you work on."
        actions={
          <Button variant="outline" disabled={!q.data?.meta.unread || markAll.isPending} onClick={() => markAll.mutate()}>
            <CheckCheck /> Mark all read
          </Button>
        }
      />
      <Tabs
        value={filter}
        onValueChange={(v) => {
          setFilter(v as 'all' | 'unread');
          setPage(1);
        }}
        className="mb-4"
      >
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="unread">Unread{q.data?.meta.unread ? ` (${q.data.meta.unread})` : ''}</TabsTrigger>
        </TabsList>
      </Tabs>
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : !q.data ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      ) : q.data.items.length === 0 ? (
        <EmptyState icon={<Bell className="size-6" />} title={filter === 'unread' ? 'No unread notifications' : 'No notifications yet'} />
      ) : (
        <>
          <ul className="divide-y rounded-xl border bg-card">
            {q.data.items.map((n) => {
              const href = n.data.transferId ? `/transfers/${n.data.transferId}` : n.data.parcelId ? `/parcels/${n.data.parcelId}` : null;
              return (
                <li key={n._id} className={cn('flex items-start gap-3 p-4', !n.readAt && 'bg-primary/[0.04]')}>
                  <span className={cn('mt-2 size-2 shrink-0 rounded-full', n.readAt ? 'bg-transparent' : 'bg-primary')} aria-label={n.readAt ? undefined : 'Unread'} />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{n.title}</p>
                    <p className="text-sm text-muted-foreground">{n.body}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {fmtAgo(n.createdAt)}
                      {href && (
                        <>
                          {' · '}
                          <Link href={href} className="font-medium text-primary hover:underline" onClick={() => !n.readAt && markOne.mutate(n._id)}>
                            Open
                          </Link>
                        </>
                      )}
                    </p>
                  </div>
                  <ConfirmAction
                    tier="T1"
                    title="Delete notification?"
                    description={`“${n.title}” will be removed from your inbox. The ledger record it refers to is not affected.`}
                    trigger={
                      <Button variant="ghost" size="icon" aria-label={`Delete notification: ${n.title}`}>
                        <Trash2 />
                      </Button>
                    }
                    confirmLabel="Delete"
                    successMessage="Notification deleted."
                    onConfirm={(ctx) => send('delete', `/notifications/${n._id}`, undefined, { idempotencyKey: ctx.idempotencyKey })}
                    onSuccess={refresh}
                  />
                </li>
              );
            })}
          </ul>
          <Pagination meta={q.data.meta} onPage={setPage} />
        </>
      )}
    </>
  );
}
