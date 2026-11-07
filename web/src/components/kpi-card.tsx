'use client';

import type { LucideIcon } from 'lucide-react';
import { animate, motion, useInView, useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/** Count-up number (CLAUDE.md §10.6); static under reduced motion. */
export function CountUp({ value, className }: { value: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(0);

  useEffect(() => {
    if (reduce || !inView) return;
    const controls = animate(0, value, { duration: 0.9, ease: 'easeOut', onUpdate: (v) => setShown(Math.round(v)) });
    return () => controls.stop();
  }, [value, inView, reduce]);

  return (
    <span ref={ref} className={cn('tabular-nums', className)} aria-label={String(value)}>
      {(reduce ? value : shown).toLocaleString('en')}
    </span>
  );
}

export function KpiCard({
  label,
  value,
  icon: Icon,
  tone = 'var(--primary)',
  hint,
  index = 0,
}: {
  label: string;
  value: number;
  icon: LucideIcon;
  tone?: string;
  hint?: string;
  index?: number;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut', delay: index * 0.06 }}
      className="h-full"
    >
      <Card className="h-full gap-3 p-5 shadow-[var(--shadow-raised)]">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-muted-foreground">{label}</span>
          <span className="grid size-9 place-items-center rounded-lg" style={{ background: `color-mix(in oklab, ${tone} 14%, transparent)`, color: tone }}>
            <Icon className="size-5" aria-hidden />
          </span>
        </div>
        <CountUp value={value} className="text-3xl font-bold tracking-tight" />
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </Card>
    </motion.div>
  );
}
