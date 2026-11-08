'use client';

import { useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, MessageSquareText, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { ConfirmAction } from '@/components/confirm-action';
import { EmptyState, ErrorState, PageHeader } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { type CannedResponse, ticketWrite, useCanned } from '@/lib/support';

function CannedForm({ value, onChange }: { value: { title: string; body: string; tags: string }; onChange: (v: { title: string; body: string; tags: string }) => void }) {
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="c-title">Title</Label>
        <Input id="c-title" value={value.title} onChange={(e) => onChange({ ...value, title: e.target.value })} maxLength={80} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="c-body">Message</Label>
        <Textarea id="c-body" rows={6} value={value.body} onChange={(e) => onChange({ ...value, body: e.target.value })} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="c-tags">Tags (comma separated)</Label>
        <Input id="c-tags" value={value.tags} onChange={(e) => onChange({ ...value, tags: e.target.value })} />
      </div>
    </div>
  );
}

const toBody = (v: { title: string; body: string; tags: string }) => ({
  title: v.title.trim(),
  body: v.body.trim(),
  tags: v.tags.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean),
});
const valid = (v: { title: string; body: string }) => v.title.trim().length >= 2 && v.body.trim().length >= 2;

export function CannedView() {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const list = useCanned(q);
  const [draft, setDraft] = useState({ title: '', body: '', tags: '' });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['canned'] });

  return (
    <>
      <Link href="/support" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" aria-hidden /> Support queue
      </Link>
      <PageHeader
        title="Canned responses"
        description="Reusable replies for common questions. Insert them from the chat composer."
        actions={
          <ConfirmAction
            tier="T1"
            title="New canned response"
            trigger={
              <Button>
                <Plus /> New response
              </Button>
            }
            canConfirm={valid(draft)}
            confirmLabel="Create"
            successMessage="Canned response created"
            onConfirm={(ctx) => ticketWrite('post', '/support/canned', toBody(draft), ctx.idempotencyKey)}
            onSuccess={() => {
              setDraft({ title: '', body: '', tags: '' });
              refresh();
            }}
          >
            <CannedForm value={draft} onChange={setDraft} />
          </ConfirmAction>
        }
      />
      <div className="relative mb-4 sm:w-80">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search responses" className="bg-card pl-9" aria-label="Search canned responses" />
      </div>
      {list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : list.isLoading ? (
        <div className="grid gap-3 md:grid-cols-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-32 rounded-xl" />)}</div>
      ) : (list.data ?? []).length === 0 ? (
        <EmptyState icon={<MessageSquareText className="size-6" />} title="No canned responses" description="Create one for answers you give often." />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {list.data!.map((c) => (
            <CannedCard key={c._id} c={c} onChanged={refresh} />
          ))}
        </div>
      )}
    </>
  );
}

function CannedCard({ c, onChanged }: { c: CannedResponse; onChanged: () => void }) {
  const [edit, setEdit] = useState({ title: c.title, body: c.body, tags: c.tags.join(', ') });
  return (
    <Card>
      <CardContent className="space-y-2">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-semibold">{c.title}</h3>
          <div className="flex gap-1">
            <ConfirmAction
              tier="T1"
              title={`Edit “${c.title}”`}
              trigger={
                <Button size="icon-sm" variant="ghost" aria-label={`Edit ${c.title}`}>
                  <Pencil />
                </Button>
              }
              canConfirm={valid(edit)}
              confirmLabel="Save"
              successMessage="Canned response updated"
              onConfirm={(ctx) => ticketWrite('patch', `/support/canned/${c._id}`, toBody(edit), ctx.idempotencyKey)}
              onSuccess={onChanged}
            >
              <CannedForm value={edit} onChange={setEdit} />
            </ConfirmAction>
            <ConfirmAction
              tier="T2"
              title="Delete this canned response?"
              consequences={['Agents will no longer see it in the composer.']}
              typeToConfirm={c.title}
              trigger={
                <Button size="icon-sm" variant="ghost" className="text-destructive" aria-label={`Delete ${c.title}`}>
                  <Trash2 />
                </Button>
              }
              confirmLabel="Delete"
              successMessage="Canned response deleted"
              onConfirm={(ctx) => ticketWrite('delete', `/support/canned/${c._id}`, undefined, ctx.idempotencyKey)}
              onSuccess={onChanged}
            />
          </div>
        </div>
        <p className="line-clamp-4 text-sm whitespace-pre-wrap text-muted-foreground">{c.body}</p>
        <div className="flex flex-wrap gap-1">
          {c.tags.map((t) => (
            <Badge key={t} variant="secondary">
              {t}
            </Badge>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
