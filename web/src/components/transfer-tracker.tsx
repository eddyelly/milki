'use client';

import { Ban } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { fmtDate } from '@/lib/format';
import { TRANSFER_STEPS } from '@/lib/status';
import type { Transfer, TransferStatus } from '@/lib/types';
import { cn } from '@/lib/utils';

const ORDER: TransferStatus[] = ['INITIATED', 'BUYER_ACCEPTED', 'PAYMENTS_CONFIRMED', 'OFFICER_VERIFIED', 'COMPLETED'];

/** Index of the last reached happy-path step; for CANCELLED/REJECTED, the step before it closed. */
function reachedIndex(t: Pick<Transfer, 'status' | 'history'>): number {
  if (t.status === 'APPROVED' || t.status === 'COMPLETED') return ORDER.length - 1;
  if (t.status === 'CANCELLED' || t.status === 'REJECTED') {
    const reached = t.history.map((h) => ORDER.indexOf(h.status)).filter((i) => i >= 0);
    return reached.length ? Math.max(...reached) : 0;
  }
  return Math.max(0, ORDER.indexOf(t.status));
}

/**
 * Transfer tracker (CLAUDE.md §10.3): the progress line fills between stages, the current stage breathes,
 * completed stages tick with a check-draw.
 */
export function TransferTracker({ transfer }: { transfer: Pick<Transfer, 'status' | 'history'> }) {
  const reduce = useReducedMotion() ?? false;
  const idx = reachedIndex(transfer);
  const closed = transfer.status === 'CANCELLED' || transfer.status === 'REJECTED';
  const done = transfer.status === 'COMPLETED';
  const atOf = (s: TransferStatus) => transfer.history.find((h) => h.status === s)?.at;
  const fill = (idx / (ORDER.length - 1)) * 100;

  return (
    <div className="relative" role="list" aria-label="Transfer progress">
      <div className="absolute top-5 right-[10%] left-[10%] h-1 rounded-full bg-border" aria-hidden>
        <motion.div
          className={cn('h-full rounded-full', closed ? 'bg-destructive/60' : 'bg-primary')}
          initial={reduce ? false : { width: 0 }}
          animate={{ width: `${fill}%` }}
          transition={{ duration: 0.7, ease: 'easeOut' }}
        />
      </div>
      <ol className="relative grid grid-cols-5 gap-1">
        {TRANSFER_STEPS.map((step, i) => {
          const complete = i < idx || (i === idx && done);
          const current = i === idx && !done && !closed;
          const stoppedHere = closed && i === idx + 1;
          const at = atOf(step.status === 'COMPLETED' ? 'COMPLETED' : step.status);
          return (
            <li key={step.status} role="listitem" aria-current={current ? 'step' : undefined} className="flex flex-col items-center gap-2 text-center">
              <motion.span
                className={cn(
                  'relative grid size-10 place-items-center rounded-full border-2 bg-card text-sm font-semibold',
                  complete && 'border-primary bg-primary text-primary-foreground',
                  current && 'border-gold text-gold-ink',
                  stoppedHere && 'border-destructive text-destructive',
                  !complete && !current && !stoppedHere && 'text-muted-foreground',
                )}
                animate={current && !reduce ? { scale: [1, 1.08, 1], boxShadow: ['0 0 0 0 rgba(233,185,73,0.45)', '0 0 0 8px rgba(233,185,73,0)', '0 0 0 0 rgba(233,185,73,0)'] } : undefined}
                transition={current && !reduce ? { duration: 2.2, repeat: Infinity, ease: 'easeInOut' } : undefined}
              >
                {complete ? (
                  <svg viewBox="0 0 24 24" className="size-5" aria-hidden>
                    <motion.path
                      d="M5 12.5l4.2 4.2L19 7"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      initial={reduce ? false : { pathLength: 0 }}
                      animate={{ pathLength: 1 }}
                      transition={{ duration: 0.35, delay: reduce ? 0 : 0.15 + i * 0.1 }}
                    />
                  </svg>
                ) : stoppedHere ? (
                  <Ban className="size-5" aria-hidden />
                ) : (
                  i + 1
                )}
              </motion.span>
              <span className="space-y-0.5">
                <span className={cn('block text-xs font-semibold sm:text-sm', !complete && !current && 'text-muted-foreground')}>{step.label}</span>
                <span className="block text-[11px] text-muted-foreground">{at ? fmtDate(at) : step.actor}</span>
              </span>
            </li>
          );
        })}
      </ol>
      {closed && (
        <p className="mt-4 rounded-md bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive" role="status">
          {transfer.status === 'CANCELLED' ? 'Cancelled by the seller.' : 'Rejected by the land registry.'}
        </p>
      )}
    </div>
  );
}
