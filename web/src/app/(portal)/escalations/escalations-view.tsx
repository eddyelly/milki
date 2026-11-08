'use client';

import { useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, CheckCircle2, ShieldAlert } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { ConfirmAction } from '@/components/confirm-action';
import { EmptyState, ErrorState, PageHeader } from '@/components/page';
import { PriorityBadge } from '@/components/support/sla';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/lib/auth';
import { fmtAgo, fmtDateTime } from '@/lib/format';
import { type Escalation, ticketWrite, useEscalations } from '@/lib/support';

/** "Escalate to officer" tasks from support (CLAUDE.md §11). Officers answer; the answer returns to the ticket. */
export function EscalationsView() {
  const [status, setStatus] = useState<'OPEN' | 'DONE'>('OPEN');
  const list = useEscalations(status);
  return (
    <>
      <PageHeader title="Escalations from support" description="Questions support agents need the land office to check. Your answer goes back to the agent as an internal note." />
      <Tabs value={status} onValueChange={(v) => setStatus(v as 'OPEN' | 'DONE')} className="mb-4">
        <TabsList>
          <TabsTrigger value="OPEN">Open</TabsTrigger>
          <TabsTrigger value="DONE">Answered</TabsTrigger>
        </TabsList>
      </Tabs>
      {list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : list.isLoading ? (
        <div className="space-y-3">{[0, 1].map((i) => <Skeleton key={i} className="h-32 rounded-xl" />)}</div>
      ) : (list.data ?? []).length === 0 ? (
        <EmptyState icon={<ShieldAlert className="size-6" />} title={status === 'OPEN' ? 'Nothing escalated' : 'No answered escalations yet'} description="New escalations appear here live." />
      ) : (
        <div className="space-y-3">
          {list.data!.map((e) => (
            <EscalationCard key={e.id} e={e} />
          ))}
        </div>
      )}
    </>
  );
}

function EscalationCard({ e }: { e: Escalation }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [answer, setAnswer] = useState('');
  const canAnswer = e.status === 'OPEN' && (user?.role === 'LAND_OFFICER' || user?.role === 'REGISTRAR');
  return (
    <Card>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs font-semibold text-muted-foreground">{e.ticketNumber}</span>
          {e.priority && <PriorityBadge priority={e.priority} />}
          {e.status === 'DONE' ? <Badge className="bg-success/15 text-success">Answered</Badge> : <Badge className="bg-gold/25 text-gold-ink">Open</Badge>}
          <span className="ml-auto text-xs text-muted-foreground">
            {e.createdByName ?? 'Support'} · {fmtAgo(e.createdAt)}
          </span>
        </div>
        {e.subject && <h3 className="font-semibold">{e.subject}</h3>}
        <p className="text-sm whitespace-pre-wrap">{e.note}</p>
        <div className="flex flex-wrap gap-3 text-sm">
          {e.parcelId && (
            <Link href={`/parcels/${e.parcelId}`} className="inline-flex items-center gap-1 font-mono font-semibold text-primary hover:underline">
              {e.parcelId} <ArrowUpRight className="size-3" aria-hidden />
            </Link>
          )}
          {e.transferId && (
            <Link href={`/transfers/${e.transferId}`} className="inline-flex items-center gap-1 font-mono font-semibold text-primary hover:underline">
              {e.transferId} <ArrowUpRight className="size-3" aria-hidden />
            </Link>
          )}
        </div>
        {e.status === 'DONE' && (
          <div className="rounded-lg border border-success/30 bg-success/8 p-3 text-sm">
            <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-success">
              <CheckCircle2 className="size-3.5" aria-hidden /> {e.doneByName ?? 'Land office'} · {fmtDateTime(e.doneAt)}
            </p>
            {e.resolution}
          </div>
        )}
        {canAnswer && (
          <ConfirmAction
            tier="T1"
            title={`Answer ${e.ticketNumber}`}
            description="Your answer is added to the ticket as an internal note for the support agent."
            canConfirm={answer.trim().length >= 5}
            trigger={<Button size="sm">Answer</Button>}
            confirmLabel="Send answer"
            successMessage="Answer sent to support"
            onConfirm={(ctx) => ticketWrite('post', `/support/escalations/${e.id}/done`, { resolution: answer.trim() }, ctx.idempotencyKey)}
            onSuccess={() => void qc.invalidateQueries({ queryKey: ['escalations'] })}
          >
            <Label htmlFor={`ans-${e.id}`}>What did you find?</Label>
            <Textarea id={`ans-${e.id}`} rows={4} value={answer} onChange={(ev) => setAnswer(ev.target.value)} />
          </ConfirmAction>
        )}
      </CardContent>
    </Card>
  );
}
