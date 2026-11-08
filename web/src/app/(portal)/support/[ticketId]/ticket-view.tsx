'use client';

import { ArrowUpRight, ChevronLeft, Eye, FileText, Hand, LockKeyhole, MessageSquareText, Paperclip, Send, ShieldAlert, Star, Trash2, X } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import Link from 'next/link';
import { use, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ConfirmAction } from '@/components/confirm-action';
import { ErrorState, Fields } from '@/components/page';
import { StatusBadge } from '@/components/status-badge';
import { PresenceDot, PriorityBadge, SlaTimer, useNow } from '@/components/support/sla';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { send, toApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtAgo, fmtArea, fmtDate, fmtDateTime, ROLE_LABEL, titleCase } from '@/lib/format';
import {
  CATEGORY_LABEL,
  downloadAttachment,
  PRIORITY,
  postMessage,
  TICKET_PRIORITIES,
  TICKET_STATUS,
  TICKET_STATUSES,
  ticketWrite,
  type Attachment,
  type Ticket,
  type TicketMessage,
  type TicketPriority,
  type TicketStatus,
  useAgents,
  useCanned,
  useSupportPresence,
  useTicket,
  useTicketChat,
  useTicketContext,
  useTicketMessages,
} from '@/lib/support';
import type { ParcelStatus, TransferStatus } from '@/lib/types';
import { cn } from '@/lib/utils';

const MAX_BYTES = 10 * 1024 * 1024;
const EDIT_WINDOW_MS = 5 * 60 * 1000;

export function TicketPageClient({ params }: { params: Promise<{ ticketId: string }> }) {
  const { ticketId } = use(params);
  const t = useTicket(ticketId);
  if (t.isError)
    return (
      <>
        <BackLink />
        <ErrorState error={t.error} onRetry={() => void t.refetch()} />
      </>
    );
  if (!t.data) return <Skeleton className="h-[70vh] rounded-xl" />;
  return <Workspace ticket={t.data} />;
}

function BackLink() {
  return (
    <Link href="/support" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
      <ChevronLeft className="size-4" aria-hidden /> Support queue
    </Link>
  );
}

function Workspace({ ticket: t }: { ticket: Ticket }) {
  const { user } = useAuth();
  const presence = useSupportPresence();
  const chat = useTicketChat(t.id, user?.userId);
  return (
    <>
      <BackLink />
      <header className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-semibold text-muted-foreground">{t.number}</span>
            <StatusBadge kind="ticket" status={t.status} size="sm" />
            <PriorityBadge priority={t.priority} />
            <Badge variant="outline">{CATEGORY_LABEL[t.category]}</Badge>
          </div>
          <h1 className="text-2xl font-bold tracking-tight">{t.subject}</h1>
          <p className="text-sm text-muted-foreground">
            From <span className="font-medium text-foreground">{t.requester ?? 'requester'}</span> · opened {fmtAgo(t.createdAt)}
            {t.assignee && (
              <>
                {' '}
                · assigned to <span className="font-medium text-foreground">{t.assignee}</span>
              </>
            )}
          </p>
        </div>
        <div className="flex flex-col items-start gap-2 lg:items-end">
          <SlaTimer sla={t.sla} start={t.createdAt} className="w-56" />
          <PresenceDot count={presence} />
        </div>
      </header>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <ChatPane ticket={t} chat={chat} />
        <aside className="space-y-4">
          <TicketControls ticket={t} />
          {t.rating && <RatingCard rating={t.rating} />}
          <ContextPanel ticket={t} />
        </aside>
      </div>
    </>
  );
}

// ------------------------------------------------------------------------------------------- chat
type Chat = ReturnType<typeof useTicketChat>;

function ChatPane({ ticket: t, chat }: { ticket: Ticket; chat: Chat }) {
  const { user } = useAuth();
  const messages = useTicketMessages(t.id);
  const scroller = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const list = messages.data ?? [];

  // Read receipts: tell the requester we have seen their messages (UI state, no confirmation).
  const unreadFromOthers = list.some((m) => m.authorId !== user?.userId && !m.readBy.some((r) => r.userId === user?.userId));
  useEffect(() => {
    if (!unreadFromOthers) return;
    const timer = setTimeout(() => void send('post', `/tickets/${t.id}/read`).catch(() => undefined), 600);
    return () => clearTimeout(timer);
  }, [unreadFromOthers, t.id, list.length]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: reduce ? 'auto' : 'smooth' });
  }, [list.length, chat.typing.length, reduce]);

  return (
    <Card className="flex h-[min(74vh,52rem)] flex-col gap-0 overflow-hidden p-0">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <MessageSquareText className="size-4 text-primary" aria-hidden /> Conversation
        </div>
        <span className={cn('text-xs', chat.connected ? 'text-success' : 'text-muted-foreground')}>{chat.connected ? 'Live' : 'Reconnecting…'}</span>
      </div>
      <div ref={scroller} className="flex-1 space-y-3 overflow-y-auto bg-muted/30 px-4 py-4" aria-live="polite">
        <OriginalRequest ticket={t} />
        {messages.isLoading && <Skeleton className="h-20 w-2/3 rounded-xl" />}
        {messages.isError && <ErrorState error={messages.error} onRetry={() => void messages.refetch()} />}
        <AnimatePresence initial={false}>
          {list.map((m) => (
            <MessageBubble key={m.id} ticket={t} message={m} mine={m.authorId === user?.userId} reduce={!!reduce} />
          ))}
        </AnimatePresence>
        <TypingIndicator typing={chat.typing} requesterId={t.userId} reduce={!!reduce} />
      </div>
      <Composer ticket={t} chat={chat} />
    </Card>
  );
}

function OriginalRequest({ ticket: t }: { ticket: Ticket }) {
  return (
    <div className="max-w-[85%] rounded-xl border bg-card p-3 shadow-sm">
      <p className="mb-1 text-xs font-semibold text-muted-foreground">
        {t.requester ?? 'Requester'} · {fmtDateTime(t.createdAt)}
      </p>
      <p className="text-sm whitespace-pre-wrap">{t.description}</p>
      <AttachmentChips ticketId={t.id} attachments={t.attachments} />
    </div>
  );
}

function AttachmentChips({ ticketId, attachments }: { ticketId: string; attachments: Attachment[] }) {
  if (attachments.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {attachments.map((a) => (
        <button
          key={a.sha256}
          type="button"
          onClick={() => void downloadAttachment(ticketId, a).catch((e) => toast.error(toApiError(e).message))}
          className="inline-flex max-w-full items-center gap-1.5 rounded-lg border bg-background px-2 py-1 text-xs hover:border-primary"
        >
          <FileText className="size-3.5 shrink-0 text-primary" aria-hidden />
          <span className="truncate">{a.name}</span>
          <span className="text-muted-foreground">{Math.ceil(a.size / 1024)} KB</span>
        </button>
      ))}
    </div>
  );
}

/** Bubbles spring in (CLAUDE.md §10.9); internal notes are visibly different and never reach the requester. */
function MessageBubble({ ticket: t, message: m, mine, reduce }: { ticket: Ticket; message: TicketMessage; mine: boolean; reduce: boolean }) {
  const now = useNow();
  const fromRequester = m.authorId === t.userId;
  const deleted = !!m.deletedAt;
  const seen = !fromRequester && !m.internal && m.readBy.some((r) => r.userId === t.userId);
  const canChange = mine && !deleted && now - Date.parse(m.createdAt) < EDIT_WINDOW_MS;
  return (
    <motion.div
      layout={!reduce}
      initial={reduce ? false : { opacity: 0, y: 10, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 30 }}
      className={cn('flex', fromRequester ? 'justify-start' : 'justify-end', m.internal && 'justify-center')}
      data-message={m.id}
    >
      <div
        className={cn(
          'group relative max-w-[85%] rounded-xl px-3 py-2 text-sm shadow-sm',
          m.internal ? 'w-full max-w-full border border-dashed border-gold bg-gold/10' : fromRequester ? 'rounded-tl-sm border bg-card' : 'rounded-tr-sm bg-primary text-primary-foreground',
        )}
      >
        <p className={cn('mb-0.5 flex items-center gap-1.5 text-xs font-semibold', m.internal ? 'text-gold-ink' : fromRequester ? 'text-muted-foreground' : 'text-primary-foreground/80')}>
          {m.internal && <LockKeyhole className="size-3" aria-hidden />}
          {m.internal ? 'Internal note · ' : ''}
          {m.author ?? ROLE_LABEL[m.authorRole]}
        </p>
        {deleted ? <p className="italic opacity-70">Message deleted</p> : m.body && <p className="whitespace-pre-wrap">{m.body}</p>}
        {!deleted && <AttachmentChips ticketId={t.id} attachments={m.attachments} />}
        <p className={cn('mt-1 flex items-center justify-end gap-2 text-[11px]', fromRequester || m.internal ? 'text-muted-foreground' : 'text-primary-foreground/75')}>
          {m.editedAt && !deleted && <span>edited</span>}
          <time dateTime={m.createdAt}>{fmtDateTime(m.createdAt)}</time>
          {seen && (
            <span className="inline-flex items-center gap-0.5" title="Seen by the requester">
              <Eye className="size-3" aria-hidden /> Seen
            </span>
          )}
        </p>
        {canChange && <MessageActions ticket={t} message={m} />}
      </div>
    </motion.div>
  );
}

function MessageActions({ ticket: t, message: m }: { ticket: Ticket; message: TicketMessage }) {
  const [body, setBody] = useState(m.body);
  return (
    <div className="absolute -top-3 right-2 hidden gap-1 group-focus-within:flex group-hover:flex">
      <ConfirmAction
        tier="T1"
        title="Edit message"
        description="You can change a message for 5 minutes after sending it."
        trigger={
          <Button size="xs" variant="secondary" className="h-6 px-2 text-xs shadow">
            Edit
          </Button>
        }
        canConfirm={body.trim().length > 0 && body.trim() !== m.body}
        confirmLabel="Save"
        successMessage="Message updated"
        onConfirm={(ctx) => ticketWrite('patch', `/tickets/${t.id}/messages/${m.id}`, { body: body.trim() }, ctx.idempotencyKey)}
      >
        <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} aria-label="Message" />
      </ConfirmAction>
      <ConfirmAction
        tier="T1"
        title="Delete this message?"
        description="It is removed for everyone in the conversation."
        trigger={
          <Button size="xs" variant="secondary" className="h-6 px-2 text-xs shadow" aria-label="Delete message">
            <Trash2 className="size-3" />
          </Button>
        }
        confirmLabel="Delete"
        successMessage="Message deleted"
        onConfirm={(ctx) => ticketWrite('delete', `/tickets/${t.id}/messages/${m.id}`, undefined, ctx.idempotencyKey)}
      />
    </div>
  );
}

/** Three bouncing dots (CLAUDE.md §10.9). */
function TypingIndicator({ typing, requesterId, reduce }: { typing: { userId: string; role: string }[]; requesterId: string; reduce: boolean }) {
  if (typing.length === 0) return null;
  const who = typing.some((x) => x.userId === requesterId) ? 'Requester' : 'Another agent';
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground" role="status" aria-label={`${who} is typing`}>
      <span className="flex items-center gap-1 rounded-full border bg-card px-3 py-2">
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="size-1.5 rounded-full bg-muted-foreground"
            animate={reduce ? undefined : { y: [0, -4, 0] }}
            transition={reduce ? undefined : { duration: 0.8, repeat: Infinity, delay: i * 0.15, ease: 'easeInOut' }}
          />
        ))}
      </span>
      {who} is typing…
    </div>
  );
}

function Composer({ ticket: t, chat }: { ticket: Ticket; chat: Chat }) {
  const [internal, setInternal] = useState(false);
  const [body, setBody] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [pending, setPending] = useState(false);
  const [cannedOpen, setCannedOpen] = useState(false);
  const canned = useCanned();
  const fileRef = useRef<HTMLInputElement>(null);
  // Stable per message, so a retried send never posts twice (CLAUDE.md §8).
  const keyRef = useRef(crypto.randomUUID());
  const closed = t.status === 'CLOSED';

  const submit = async () => {
    if ((!body.trim() && !file) || pending) return;
    setPending(true);
    try {
      const m = await postMessage(t.id, body.trim(), internal, file, keyRef.current);
      chat.addLocal(m);
      chat.sendTyping(false, internal);
      setBody('');
      setFile(null);
      keyRef.current = crypto.randomUUID();
    } catch (e) {
      toast.error(toApiError(e).message);
    } finally {
      setPending(false);
    }
  };

  if (closed) {
    return <div className="border-t px-4 py-3 text-sm text-muted-foreground">This ticket is closed. The requester can reopen it within 7 days of resolution.</div>;
  }

  return (
    <div className={cn('border-t p-3', internal && 'bg-gold/8')}>
      <div className="mb-2 flex items-center gap-1" role="tablist" aria-label="Message type">
        {[
          { v: false, label: 'Reply to requester' },
          { v: true, label: 'Internal note' },
        ].map((o) => (
          <button
            key={o.label}
            role="tab"
            type="button"
            aria-selected={internal === o.v}
            onClick={() => setInternal(o.v)}
            className={cn(
              'rounded-full px-3 py-1 text-xs font-semibold transition-colors',
              internal === o.v ? (o.v ? 'bg-gold/30 text-gold-ink' : 'bg-primary/12 text-primary') : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {o.v && <LockKeyhole className="mr-1 inline size-3" aria-hidden />}
            {o.label}
          </button>
        ))}
      </div>
      <Textarea
        value={body}
        onChange={(e) => {
          setBody(e.target.value);
          chat.sendTyping(e.target.value.length > 0, internal);
        }}
        onBlur={() => chat.sendTyping(false, internal)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void submit();
          }
        }}
        rows={3}
        placeholder={internal ? 'Visible to support staff only…' : 'Write a reply… (Ctrl+Enter to send)'}
        aria-label={internal ? 'Internal note' : 'Reply'}
        className="resize-none bg-card"
      />
      {file && (
        <div className="mt-2 inline-flex items-center gap-2 rounded-lg border bg-card px-2 py-1 text-xs">
          <FileText className="size-3.5 text-primary" aria-hidden />
          {file.name}
          <button type="button" onClick={() => setFile(null)} aria-label="Remove attachment">
            <X className="size-3.5" />
          </button>
        </div>
      )}
      <div className="mt-2 flex items-center gap-2">
        <Popover open={cannedOpen} onOpenChange={setCannedOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm">
              <MessageSquareText /> Canned
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80 p-0" align="start">
            <Command>
              <CommandInput placeholder="Search canned responses…" />
              <CommandList>
                <CommandEmpty>No canned responses.</CommandEmpty>
                <CommandGroup>
                  {(canned.data ?? []).map((c) => (
                    <CommandItem
                      key={c._id}
                      value={`${c.title} ${c.tags.join(' ')}`}
                      onSelect={() => {
                        setBody((b) => (b ? `${b}\n\n${c.body}` : c.body));
                        setCannedOpen(false);
                      }}
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{c.title}</p>
                        <p className="truncate text-xs text-muted-foreground">{c.body}</p>
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf,image/jpeg,image/png"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            e.target.value = '';
            if (f && f.size > MAX_BYTES) return toast.error('Attachments can be at most 10 MB.');
            setFile(f);
          }}
        />
        <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} aria-label="Attach a file">
          <Paperclip />
        </Button>
        <Button className="ml-auto" size="sm" onClick={() => void submit()} disabled={pending || (!body.trim() && !file)} variant={internal ? 'secondary' : 'default'}>
          <Send /> {internal ? 'Add note' : 'Send'}
        </Button>
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------------------- controls
function TicketControls({ ticket: t }: { ticket: Ticket }) {
  const { user } = useAuth();
  const agents = useAgents();
  // Only the agent's pending edits are local; everything else follows the live ticket.
  const [edits, setEdits] = useState<{ status?: TicketStatus; priority?: TicketPriority; assignee?: string; tags?: string }>({});
  const status = edits.status ?? t.status;
  const priority = edits.priority ?? t.priority;
  const assignee = edits.assignee ?? t.assigneeId ?? 'none';
  const tags = edits.tags ?? t.tags.join(', ');
  const [note, setNote] = useState('');
  const dirty = Object.keys(edits).length > 0;
  const setDirty = (d: boolean) => !d && setEdits({});

  const tagList = useMemo(() => [...new Set(tags.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean))], [tags]);
  const agentName = (id: string) => (id === 'none' ? 'Unassigned' : (agents.data?.find((a) => a.userId === id)?.fullName ?? id));
  const changes = [
    status !== t.status && { label: 'Status', value: `${TICKET_STATUS[t.status].label} → ${TICKET_STATUS[status].label}` },
    priority !== t.priority && { label: 'Priority', value: `${PRIORITY[t.priority].label} → ${PRIORITY[priority].label} (SLA recalculated)` },
    assignee !== (t.assigneeId ?? 'none') && { label: 'Assignee', value: `${t.assignee ?? 'Unassigned'} → ${agentName(assignee)}` },
    tagList.join(',') !== t.tags.join(',') && { label: 'Tags', value: tagList.join(', ') || '—' },
  ].filter(Boolean) as { label: string; value: string }[];

  const body: Record<string, unknown> = {};
  if (status !== t.status) body.status = status;
  if (priority !== t.priority) body.priority = priority;
  if (assignee !== (t.assigneeId ?? 'none')) body.assigneeId = assignee === 'none' ? null : assignee;
  if (tagList.join(',') !== t.tags.join(',')) body.tags = tagList;
  const closed = t.status === 'CLOSED';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Ticket</CardTitle>
        <CardDescription>Changes are confirmed before they are saved.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {t.assigneeId !== user?.userId && !closed && (
          <ConfirmAction
            tier="T1"
            title={`Claim ${t.number}?`}
            impact={[
              { label: 'Assignee', value: `${t.assignee ?? 'Unassigned'} → you` },
              ...(t.status === 'OPEN' ? [{ label: 'Status', value: 'Open → In progress' }] : []),
            ]}
            trigger={
              <Button className="w-full" variant={t.assigneeId ? 'outline' : 'default'}>
                <Hand /> {t.assigneeId ? 'Take over' : 'Claim ticket'}
              </Button>
            }
            successMessage="Ticket claimed"
            onConfirm={(ctx) =>
              t.assigneeId ? ticketWrite('patch', `/tickets/${t.id}`, { assigneeId: user?.userId }, ctx.idempotencyKey) : ticketWrite('post', `/tickets/${t.id}/claim`, {}, ctx.idempotencyKey)
            }
          />
        )}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="t-status">Status</Label>
            <Select value={status} onValueChange={(v) => setEdits((e) => ({ ...e, status: v as TicketStatus }))} disabled={closed}>
              <SelectTrigger id="t-status" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TICKET_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {TICKET_STATUS[s].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="t-priority">Priority</Label>
            <Select value={priority} onValueChange={(v) => setEdits((e) => ({ ...e, priority: v as TicketPriority }))} disabled={closed}>
              <SelectTrigger id="t-priority" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TICKET_PRIORITIES.map((p) => (
                  <SelectItem key={p} value={p}>
                    {PRIORITY[p].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="t-assignee">Assignee</Label>
          <Select value={assignee} onValueChange={(v) => setEdits((e) => ({ ...e, assignee: v }))} disabled={closed}>
            <SelectTrigger id="t-assignee" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Unassigned</SelectItem>
              {(agents.data ?? []).map((a) => (
                <SelectItem key={a.userId} value={a.userId}>
                  {a.fullName}
                  {a.userId === user?.userId ? ' (you)' : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="t-tags">Tags</Label>
          <Input id="t-tags" value={tags} onChange={(ev) => setEdits((e) => ({ ...e, tags: ev.target.value }))} placeholder="e.g. otp, mortgage" disabled={closed} />
        </div>
        <div className="flex gap-2">
          <ConfirmAction
            tier="T1"
            title={`Update ${t.number}`}
            impact={changes}
            consequences={status === 'RESOLVED' ? ['The requester is notified and asked to rate the help. They can reopen within 7 days.'] : []}
            trigger={
              <Button className="flex-1" disabled={changes.length === 0}>
                Save changes
              </Button>
            }
            successMessage="Ticket updated"
            onConfirm={(ctx) => ticketWrite('patch', `/tickets/${t.id}`, body, ctx.idempotencyKey)}
            onSuccess={() => setDirty(false)}
          />
          {dirty && (
            <Button
              variant="ghost"
              onClick={() => {
                setDirty(false);
              }}
            >
              Reset
            </Button>
          )}
        </div>
        <div className="flex flex-col gap-2 border-t pt-3">
          <ConfirmAction
            tier="T1"
            title="Escalate to a land officer"
            description="Creates an internal task for the land office. The requester does not see it; the officer's answer comes back here as an internal note."
            impact={[
              { label: 'Ticket', value: t.number, mono: true },
              ...(t.parcelId ? [{ label: 'Parcel', value: t.parcelId, mono: true }] : []),
              ...(t.transferId ? [{ label: 'Transfer', value: t.transferId, mono: true }] : []),
            ]}
            canConfirm={note.trim().length >= 10}
            trigger={
              <Button variant="outline" disabled={closed}>
                <ShieldAlert /> Escalate to officer
              </Button>
            }
            confirmLabel="Escalate"
            successMessage="Escalated to the land office"
            onConfirm={(ctx) => ticketWrite('post', `/tickets/${t.id}/escalate`, { note: note.trim() }, ctx.idempotencyKey)}
            onSuccess={() => setNote('')}
          >
            <Label htmlFor="esc-note">What should the officer check?</Label>
            <Textarea id="esc-note" value={note} onChange={(e) => setNote(e.target.value)} rows={4} placeholder="At least 10 characters" />
          </ConfirmAction>
          {!closed && (
            <ConfirmAction
              tier="T2"
              title={`Close ${t.number}?`}
              description="Closing ends the conversation. The requester can only reopen within 7 days of resolution."
              consequences={['No more messages can be sent on this ticket.', 'The SLA clock stops.']}
              typeToConfirm={t.number}
              trigger={
                <Button variant="ghost" className="text-destructive hover:text-destructive">
                  <X /> Close ticket
                </Button>
              }
              confirmLabel="Close ticket"
              successMessage="Ticket closed"
              onConfirm={(ctx) => ticketWrite('post', `/tickets/${t.id}/close`, {}, ctx.idempotencyKey)}
            />
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function RatingCard({ rating }: { rating: NonNullable<Ticket['rating']> }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Requester rating</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-0.5" aria-label={`${rating.stars} of 5 stars`}>
          {[1, 2, 3, 4, 5].map((i) => (
            <Star key={i} className={cn('size-5', i <= rating.stars ? 'fill-gold text-gold' : 'text-muted-foreground/40')} aria-hidden />
          ))}
        </div>
        {rating.comment && <p className="mt-2 text-sm">“{rating.comment}”</p>}
        <p className="mt-1 text-xs text-muted-foreground">{fmtDate(rating.at)}</p>
      </CardContent>
    </Card>
  );
}

/** Read-only context (CLAUDE.md §11): agents see but never change ledger data. */
function ContextPanel({ ticket: t }: { ticket: Ticket }) {
  const ctx = useTicketContext(t.id);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          Requester context <Badge variant="secondary">Read-only</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {ctx.isLoading && <Skeleton className="h-40" />}
        {ctx.isError && <ErrorState error={ctx.error} onRetry={() => void ctx.refetch()} />}
        {ctx.data && (
          <>
            {ctx.data.user && (
              <Fields
                className="sm:grid-cols-1"
                items={[
                  { label: 'Name', value: ctx.data.user.fullName },
                  { label: 'Phone', value: ctx.data.user.phone, mono: true },
                  { label: 'Language', value: ctx.data.user.preferredLanguage === 'sw' ? 'Kiswahili' : 'English' },
                  { label: 'Member since', value: fmtDate(ctx.data.user.memberSince) },
                ]}
              />
            )}
            {(ctx.data.linked.parcelId || ctx.data.linked.transferId) && (
              <div className="rounded-lg border border-gold/40 bg-gold/10 p-3 text-sm">
                <p className="mb-1 text-xs font-semibold text-gold-ink">Opened from</p>
                {ctx.data.linked.parcelId && <LedgerLink href={`/parcels/${ctx.data.linked.parcelId}`} label={ctx.data.linked.parcelId} />}
                {ctx.data.linked.transferId && <LedgerLink href={`/transfers/${ctx.data.linked.transferId}`} label={ctx.data.linked.transferId} />}
              </div>
            )}
            <section>
              <h3 className="mb-2 text-xs font-semibold text-muted-foreground uppercase">Parcels ({ctx.data.parcels.length})</h3>
              {ctx.data.parcels.length === 0 ? (
                <p className="text-sm text-muted-foreground">No parcels in their name.</p>
              ) : (
                <ul className="space-y-2">
                  {ctx.data.parcels.map((p) => (
                    <li key={p.parcelId} className="flex items-center justify-between gap-2 text-sm">
                      <div className="min-w-0">
                        <LedgerLink href={`/parcels/${p.parcelId}`} label={p.parcelId} />
                        <p className="truncate text-xs text-muted-foreground">
                          {p.ward}, {p.district} · {fmtArea(p.area)}
                        </p>
                      </div>
                      <StatusBadge kind="parcel" status={p.status as ParcelStatus} size="sm" />
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section>
              <h3 className="mb-2 text-xs font-semibold text-muted-foreground uppercase">Transfers ({ctx.data.transfers.length})</h3>
              {ctx.data.transfers.length === 0 ? (
                <p className="text-sm text-muted-foreground">No transfers.</p>
              ) : (
                <ul className="space-y-2">
                  {ctx.data.transfers.map((x) => (
                    <li key={x.transferId} className="flex items-center justify-between gap-2 text-sm">
                      <div className="min-w-0">
                        <LedgerLink href={`/transfers/${x.transferId}`} label={x.transferId} />
                        <p className="text-xs text-muted-foreground">
                          {titleCase(x.side)} · {x.parcelId}
                        </p>
                      </div>
                      <StatusBadge kind="transfer" status={x.status as TransferStatus} size="sm" />
                    </li>
                  ))}
                </ul>
              )}
            </section>
            {ctx.data.previousTickets.length > 0 && (
              <section>
                <h3 className="mb-2 text-xs font-semibold text-muted-foreground uppercase">Previous tickets</h3>
                <ul className="space-y-1.5">
                  {ctx.data.previousTickets.map((p) => (
                    <li key={p._id} className="flex items-center justify-between gap-2 text-sm">
                      <Link href={`/support/${p._id}`} className="min-w-0 truncate hover:underline">
                        <span className="font-mono text-xs text-muted-foreground">{p.number}</span> {p.subject}
                      </Link>
                      <StatusBadge kind="ticket" status={p.status} size="sm" />
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function LedgerLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="inline-flex items-center gap-1 font-mono text-sm font-semibold text-primary hover:underline">
      {label} <ArrowUpRight className="size-3" aria-hidden />
    </Link>
  );
}
