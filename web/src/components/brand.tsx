'use client';

import { motion, useReducedMotion } from 'motion/react';
import { cn } from '@/lib/utils';

/** Milki mark: a land parcel outline sealed with a gold dot — "your land, a permanent record". */
export function Logo({ className, withWordmark = true, inverted = false }: { className?: string; withWordmark?: boolean; inverted?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <svg viewBox="0 0 32 32" className="size-8 shrink-0" aria-hidden>
        <rect x="1" y="1" width="30" height="30" rx="9" fill={inverted ? 'var(--gold)' : 'var(--primary-deep)'} />
        <path d="M8 21.5 11 9l7 3.2 6-1.7-1.6 11.8-8.4 1.4z" fill="none" stroke={inverted ? 'var(--primary-deep)' : '#E6F2EC'} strokeWidth="2" strokeLinejoin="round" />
        <circle cx="21.5" cy="21" r="3.2" fill={inverted ? 'var(--primary-deep)' : 'var(--gold)'} />
      </svg>
      {withWordmark && (
        <span className="leading-none">
          <span className="block text-lg font-bold tracking-tight">Milki</span>
          <span className="block text-[11px] font-medium opacity-70">Land Registry · Tanzania</span>
        </span>
      )}
    </span>
  );
}

/** Deterministic, organic closed contour around (cx, cy). */
function contour(cx: number, cy: number, r: number, wobble: number, phase: number): string {
  const pts = 48;
  let d = '';
  for (let i = 0; i <= pts; i++) {
    const a = (i / pts) * Math.PI * 2;
    const rr = r + Math.sin(a * 3 + phase) * wobble + Math.cos(a * 5 + phase * 1.7) * wobble * 0.5;
    const x = cx + Math.cos(a) * rr * 1.25;
    const y = cy + Math.sin(a) * rr;
    d += `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
  }
  return `${d}Z`;
}

const HILLS = [
  { cx: 220, cy: 180, rings: 9, base: 26, step: 22, phase: 0.4 },
  { cx: 860, cy: 520, rings: 11, base: 20, step: 24, phase: 1.9 },
  { cx: 1180, cy: 120, rings: 7, base: 30, step: 26, phase: 3.1 },
];
const PATHS = HILLS.flatMap((h) => Array.from({ length: h.rings }, (_, i) => contour(h.cx, h.cy, h.base + i * h.step, 6 + i * 1.6, h.phase + i * 0.35)));

/** Slow-drifting topographic contours (CLAUDE.md §9 motif, §10.7 auth background). */
export function TopoBackground({ className, drift = true }: { className?: string; drift?: boolean }) {
  const reduce = useReducedMotion();
  const animate = drift && !reduce;
  return (
    <div aria-hidden className={cn('pointer-events-none absolute inset-0 overflow-hidden', className)}>
      <motion.svg
        viewBox="0 0 1400 800"
        preserveAspectRatio="xMidYMid slice"
        className="absolute -inset-[6%] h-[112%] w-[112%]"
        animate={animate ? { x: [0, -36, 0], y: [0, 18, 0], rotate: [0, 0.6, 0] } : undefined}
        transition={animate ? { duration: 60, repeat: Infinity, ease: 'easeInOut' } : undefined}
      >
        {PATHS.map((d, i) => (
          <path key={i} d={d} fill="none" stroke="var(--contour)" strokeWidth={i % 4 === 0 ? 1.6 : 1} />
        ))}
      </motion.svg>
    </div>
  );
}
