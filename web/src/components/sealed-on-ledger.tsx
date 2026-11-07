'use client';

import { Check, X } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { CopyButton } from '@/components/copy-button';
import { shortHash } from '@/lib/format';
import { cn } from '@/lib/utils';

export type SealStage = 'submitting' | 'endorsing' | 'committed' | 'failed';

const STAGES: { key: Exclude<SealStage, 'failed'>; label: string }[] = [
  { key: 'submitting', label: 'Submitting' },
  { key: 'endorsing', label: 'Endorsing' },
  { key: 'committed', label: 'Committed' },
];

/**
 * "Sealed on the ledger" (CLAUDE.md §10.1): a pulsing gold ring while submitting, chain links snapping
 * together while peers endorse and the orderer commits, then a gold seal stamp with block number and txId.
 */
export function SealedOnLedger({ stage, txId, blockNumber, error }: { stage: SealStage; txId?: string; blockNumber?: number; error?: string }) {
  const reduce = useReducedMotion() ?? false;
  const idx = stage === 'failed' ? -1 : STAGES.findIndex((s) => s.key === stage);

  return (
    <div className="flex flex-col items-center gap-5 py-2" aria-live="polite">
      <div className="relative grid size-40 place-items-center">
        <AnimatePresence mode="wait">
          {stage === 'submitting' && <Ring key="ring" reduce={reduce} />}
          {stage === 'endorsing' && <Chain key="chain" reduce={reduce} />}
          {stage === 'committed' && <Seal key="seal" reduce={reduce} blockNumber={blockNumber} />}
          {stage === 'failed' && (
            <motion.div
              key="failed"
              initial={reduce ? false : { scale: 0.6, opacity: 0 }}
              animate={reduce ? undefined : { scale: 1, opacity: 1, x: [0, -8, 8, -5, 5, 0] }}
              transition={{ duration: 0.45 }}
              className="grid size-28 place-items-center rounded-full border-4"
              style={{ borderColor: 'var(--earth)', color: 'var(--earth)' }}
            >
              <X className="size-12" strokeWidth={2.5} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <ol className="flex items-center gap-2 text-xs font-medium" aria-label="Ledger progress">
        {STAGES.map((s, i) => {
          const done = idx > i || stage === 'committed';
          const current = idx === i && stage !== 'committed';
          return (
            <li key={s.key} className="flex items-center gap-2">
              <span
                className={cn(
                  'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 transition-colors',
                  done && 'border-primary/30 bg-primary/10 text-primary',
                  current && 'border-gold/50 bg-gold/15 text-gold-ink',
                  !done && !current && 'text-muted-foreground',
                )}
                aria-current={current ? 'step' : undefined}
              >
                {done && <Check className="size-3" aria-hidden />}
                {s.label}
              </span>
              {i < STAGES.length - 1 && <span aria-hidden className="h-px w-4 bg-border" />}
            </li>
          );
        })}
      </ol>

      <div className="min-h-14 text-center">
        {stage === 'submitting' && <p className="text-sm text-muted-foreground">Signing with your ledger identity and sending to the peers…</p>}
        {stage === 'endorsing' && <p className="text-sm text-muted-foreground">Ministry and Land Office peers are endorsing; waiting for the block to commit…</p>}
        {stage === 'failed' && <p className="max-w-sm text-sm font-medium" style={{ color: 'var(--earth)' }}>{error ?? 'The ledger did not accept this transaction.'}</p>}
        {(stage === 'committed' || stage === 'endorsing') && txId && (
          <motion.div initial={reduce ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: stage === 'committed' ? 0.35 : 0, duration: 0.3 }} className="space-y-1">
            {stage === 'committed' && <p className="text-sm font-semibold text-primary">Sealed on the ledger{blockNumber !== undefined ? ` in block #${blockNumber}` : ''}</p>}
            <p className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              Transaction <span className="font-mono text-foreground">{shortHash(txId, 10, 8)}</span>
              <CopyButton value={txId} label="Copy transaction ID" />
            </p>
          </motion.div>
        )}
      </div>
    </div>
  );
}

function Ring({ reduce }: { reduce: boolean }) {
  return (
    <motion.div key="ring" exit={{ opacity: 0, scale: 0.8 }} className="relative grid place-items-center">
      {!reduce &&
        [0, 0.6].map((delay) => (
          <motion.span
            key={delay}
            className="absolute size-28 rounded-full border-2"
            style={{ borderColor: 'var(--gold)' }}
            initial={{ scale: 0.7, opacity: 0.7 }}
            animate={{ scale: 1.35, opacity: 0 }}
            transition={{ duration: 1.4, repeat: Infinity, delay, ease: 'easeOut' }}
          />
        ))}
      <span className="grid size-24 place-items-center rounded-full border-4" style={{ borderColor: 'var(--gold)' }}>
        <span className="size-3 rounded-full" style={{ background: 'var(--gold)' }} />
      </span>
    </motion.div>
  );
}

function Chain({ reduce }: { reduce: boolean }) {
  const link = 'absolute h-10 w-16 rounded-full border-[5px]';
  return (
    <motion.div key="chain" exit={{ opacity: 0 }} className="relative h-16 w-36" aria-label="Endorsing">
      <motion.span
        className={link}
        style={{ borderColor: 'var(--primary)', left: 8, top: 12 }}
        initial={reduce ? false : { x: -26, rotate: -8 }}
        animate={reduce ? undefined : { x: [-26, 6, 0], rotate: [-8, 3, 0] }}
        transition={{ duration: 0.45, ease: 'easeOut' }}
      />
      <motion.span
        className={link}
        style={{ borderColor: 'var(--gold)', right: 8, top: 12 }}
        initial={reduce ? false : { x: 26, rotate: 8 }}
        animate={reduce ? undefined : { x: [26, -6, 0], rotate: [8, -3, 0] }}
        transition={{ duration: 0.45, ease: 'easeOut' }}
      />
      {!reduce && (
        <motion.span
          className="absolute top-1/2 left-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{ background: 'var(--gold)' }}
          animate={{ scale: [1, 1.8, 1], opacity: [1, 0.4, 1] }}
          transition={{ duration: 1.2, repeat: Infinity, delay: 0.45 }}
        />
      )}
    </motion.div>
  );
}

function Seal({ reduce, blockNumber }: { reduce: boolean; blockNumber?: number }) {
  return (
    <motion.div
      key="seal"
      initial={reduce ? false : { scale: 1.7, rotate: -14, opacity: 0 }}
      animate={{ scale: 1, rotate: 0, opacity: 1 }}
      transition={reduce ? undefined : { type: 'spring', stiffness: 380, damping: 18 }}
      className="relative grid size-32 place-items-center rounded-full"
      style={{ background: 'radial-gradient(circle at 35% 30%, #F7DB8C, var(--gold) 55%, #C99A2E)', boxShadow: '0 10px 30px -10px rgba(201,154,46,0.65)' }}
      role="img"
      aria-label={`Committed${blockNumber !== undefined ? ` in block ${blockNumber}` : ''}`}
    >
      <svg viewBox="0 0 128 128" className="absolute inset-0" aria-hidden>
        <defs>
          <path id="seal-arc" d="M64,64 m-46,0 a46,46 0 1,1 92,0 a46,46 0 1,1 -92,0" />
        </defs>
        <circle cx="64" cy="64" r="56" fill="none" stroke="#8A6514" strokeWidth="1.5" strokeDasharray="2 3" />
        <text fontSize="9.5" fontWeight="700" letterSpacing="2.4" fill="#5C430B">
          <textPath href="#seal-arc">MILKI · LAND REGISTRY · TANZANIA ·</textPath>
        </text>
      </svg>
      <div className="relative grid size-16 place-items-center rounded-full border-2 border-[#8A6514]/60 text-[#4A3608]">
        <motion.svg viewBox="0 0 24 24" className="size-8" aria-hidden>
          <motion.path
            d="M5 12.5l4.2 4.2L19 7"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
            initial={reduce ? false : { pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ delay: 0.25, duration: 0.35, ease: 'easeOut' }}
          />
        </motion.svg>
      </div>
      {blockNumber !== undefined && (
        <span className="absolute -bottom-2 rounded-full bg-primary-deep px-2 py-0.5 font-mono text-[11px] font-semibold text-white shadow">#{blockNumber}</span>
      )}
    </motion.div>
  );
}
