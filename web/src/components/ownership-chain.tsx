'use client';

import { ChevronDown, Link2, UserRound } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useState } from 'react';
import { CopyButton } from '@/components/copy-button';
import { StatusBadge } from '@/components/status-badge';
import { fmtDateTime, MSP_LABEL, ROLE_LABEL, shortHash } from '@/lib/format';
import type { HistoryEntry } from '@/lib/types';
import { cn } from '@/lib/utils';

/**
 * Ownership history chain (CLAUDE.md §10.2): the connecting line draws downward as it scrolls into view,
 * nodes pop in with a stagger, and each node expands to show its transaction.
 */
export function OwnershipChain({ entries }: { entries: HistoryEntry[] }) {
  const reduce = useReducedMotion() ?? false;
  const [open, setOpen] = useState<string | null>(null);
  // Newest first reads naturally for an audit trail; ownership changes are emphasised.
  const items = [...entries].reverse();

  return (
    <ol className="relative ml-4 space-y-4" aria-label="Ledger history, newest first">
      <motion.span
        aria-hidden
        className="absolute top-2 bottom-2 -left-px w-0.5 origin-top rounded-full bg-gradient-to-b from-primary via-primary/50 to-border"
        initial={reduce ? false : { scaleY: 0 }}
        whileInView={{ scaleY: 1 }}
        viewport={{ once: true, amount: 0.2 }}
        transition={{ duration: 0.8, ease: 'easeOut' }}
      />
      {items.map((e, i) => {
        const prev = items[i + 1];
        const ownerChanged = !prev || prev.ownerId !== e.ownerId;
        const expanded = open === e.txId;
        return (
          <motion.li
            key={e.txId}
            className="relative pl-7"
            initial={reduce ? false : { opacity: 0, scale: 0.92, y: 6 }}
            whileInView={{ opacity: 1, scale: 1, y: 0 }}
            viewport={{ once: true, amount: 0.4 }}
            transition={{ duration: 0.25, ease: 'easeOut', delay: reduce ? 0 : Math.min(i, 8) * 0.06 }}
          >
            <span
              aria-hidden
              className={cn(
                'absolute top-3 -left-[9px] grid size-[18px] place-items-center rounded-full border-2 bg-card',
                ownerChanged ? 'border-gold' : 'border-primary/60',
              )}
            >
              {ownerChanged ? <span className="size-2 rounded-full bg-gold" /> : <Link2 className="size-2.5 text-primary" />}
            </span>
            <button
              type="button"
              onClick={() => setOpen(expanded ? null : e.txId)}
              aria-expanded={expanded}
              className="w-full rounded-lg border bg-card p-3 text-left transition-colors hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <div className="flex flex-wrap items-center gap-2">
                {e.status && <StatusBadge kind="parcel" status={e.status} size="sm" />}
                {ownerChanged && (
                  <span className="inline-flex items-center gap-1 text-sm font-semibold">
                    <UserRound className="size-3.5 text-gold-ink" aria-hidden />
                    {i === items.length - 1 ? 'Registered to' : 'Owner'} {e.ownerName ?? <span className="font-mono text-xs">{e.ownerId}</span>}
                    {e.ownershipVersion !== null && <span className="text-xs font-normal text-muted-foreground">(v{e.ownershipVersion})</span>}
                  </span>
                )}
                <span className="ml-auto text-xs text-muted-foreground">{fmtDateTime(e.timestamp)}</span>
                <ChevronDown className={cn('size-4 text-muted-foreground transition-transform', expanded && 'rotate-180')} aria-hidden />
              </div>
              {e.note && <p className="mt-1 text-sm text-muted-foreground">“{e.note}”</p>}
            </button>
            <AnimatePresence initial={false}>
              {expanded && (
                <motion.dl
                  initial={reduce ? false : { height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={reduce ? undefined : { height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="mt-2 grid gap-2 overflow-hidden rounded-lg bg-muted/50 px-3 py-2 text-xs sm:grid-cols-2"
                >
                  <div>
                    <dt className="text-muted-foreground">Transaction</dt>
                    <dd className="flex items-center gap-1 font-mono">
                      {shortHash(e.txId, 12, 8)} <CopyButton value={e.txId} label="Copy transaction ID" />
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Signed by</dt>
                    <dd>
                      {e.changedBy ? `${ROLE_LABEL[e.changedBy.role ?? ''] ?? 'System'} · ${MSP_LABEL[e.changedBy.mspId] ?? e.changedBy.mspId}` : '—'}
                    </dd>
                  </div>
                </motion.dl>
              )}
            </AnimatePresence>
          </motion.li>
        );
      })}
    </ol>
  );
}
