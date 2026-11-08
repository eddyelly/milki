'use client';

import { AlarmClock, CheckCircle2, Flame } from 'lucide-react';
import { useEffect, useState } from 'react';
import { PRIORITY, type Sla, slaText, type TicketPriority } from '@/lib/support';
import { cn } from '@/lib/utils';

/** Re-renders every 30 s so countdowns stay current. */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

/**
 * SLA timer (CLAUDE.md §11): primary while healthy, accent (gold) from 75% of the window, danger once breached.
 * Icon + words, never colour alone.
 */
export function SlaTimer({ sla, start, compact = false, className }: { sla: Sla; start: string; compact?: boolean; className?: string }) {
  const now = useNow();
  // Recompute between refetches: the window runs from ticket creation to the due time.
  const begin = Date.parse(start);
  const due = sla.dueAt ? Date.parse(sla.dueAt) : NaN;
  const elapsed = sla.state !== 'MET' && due > begin ? (now - begin) / (due - begin) : sla.elapsed;
  const state = sla.state === 'MET' ? 'MET' : elapsed >= 1 ? 'BREACHED' : elapsed >= 0.75 ? 'WARNING' : 'OK';
  const color = state === 'BREACHED' ? 'var(--danger)' : state === 'WARNING' ? 'var(--gold-ink)' : state === 'MET' ? 'var(--success)' : 'var(--primary)';
  const bar = state === 'BREACHED' ? 'var(--danger)' : state === 'WARNING' ? 'var(--gold)' : state === 'MET' ? 'var(--success)' : 'var(--primary)';
  const Icon = state === 'BREACHED' ? Flame : state === 'MET' ? CheckCircle2 : AlarmClock;
  const text = slaText({ ...sla, state }, now);
  return (
    <div className={cn('min-w-0', className)} title={sla.dueAt ? `Due ${new Date(sla.dueAt).toLocaleString()}` : undefined} data-sla={state}>
      <div className="flex items-center gap-1.5 text-xs font-semibold" style={{ color }}>
        <Icon className="size-3.5 shrink-0" aria-hidden />
        <span className="truncate">{text}</span>
      </div>
      {!compact && state !== 'MET' && sla.target !== 'NONE' && (
        <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="SLA time used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.round(elapsed * 100))}>
          <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${Math.min(100, elapsed * 100)}%`, background: bar }} />
        </div>
      )}
    </div>
  );
}

export function PriorityBadge({ priority, className }: { priority: TicketPriority; className?: string }) {
  const p = PRIORITY[priority];
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs font-semibold whitespace-nowrap', className)} style={{ color: `color-mix(in oklab, ${p.color} 85%, var(--foreground))` }}>
      <span className="flex gap-0.5" aria-hidden>
        {[3, 2, 1, 0].map((r) => (
          <span key={r} className="h-3 w-1 rounded-full" style={{ background: p.rank <= r ? p.color : 'var(--muted)' }} />
        ))}
      </span>
      {p.label}
    </span>
  );
}

/** Agents-online dot for presence (§11). */
export function PresenceDot({ count, className }: { count: number | null; className?: string }) {
  const online = (count ?? 0) > 0;
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground', className)}>
      <span className="relative flex size-2.5">
        {online && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60 motion-reduce:hidden" />}
        <span className={cn('relative inline-flex size-2.5 rounded-full', online ? 'bg-success' : 'bg-muted-foreground/40')} />
      </span>
      {count === null ? 'Connecting…' : online ? `${count} agent${count === 1 ? '' : 's'} online` : 'No agents online'}
    </span>
  );
}
