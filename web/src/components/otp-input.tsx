'use client';

import { motion, useReducedMotion } from 'motion/react';
import { type ClipboardEvent, type KeyboardEvent, useRef } from 'react';
import { cn } from '@/lib/utils';

interface Props {
  value: string;
  onChange: (v: string) => void;
  onComplete?: (v: string) => void;
  length?: number;
  disabled?: boolean;
  invalid?: boolean;
  autoFocus?: boolean;
}

/** Six boxes for the SMS code; each bounces when a digit lands (CLAUDE.md §10.7). Paste fills them all. */
export function OtpInput({ value, onChange, onComplete, length = 6, disabled, invalid, autoFocus }: Props) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const reduce = useReducedMotion();
  const digits = Array.from({ length }, (_, i) => value[i] ?? '');

  const set = (next: string) => {
    const clean = next.replace(/\D/g, '').slice(0, length);
    onChange(clean);
    if (clean.length === length) onComplete?.(clean);
    refs.current[Math.min(clean.length, length - 1)]?.focus();
  };

  const onKey = (i: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      e.preventDefault();
      const cut = digits[i] ? i : Math.max(0, i - 1);
      set(value.slice(0, cut));
    } else if (e.key === 'ArrowLeft') refs.current[Math.max(0, i - 1)]?.focus();
    else if (e.key === 'ArrowRight') refs.current[Math.min(length - 1, i + 1)]?.focus();
  };

  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    set(e.clipboardData.getData('text'));
  };

  return (
    <div className="flex justify-center gap-2" role="group" aria-label="One-time code">
      {digits.map((d, i) => (
        <motion.input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          aria-label={`Digit ${i + 1}`}
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          maxLength={1}
          value={d}
          disabled={disabled}
          autoFocus={autoFocus && i === 0}
          aria-invalid={invalid || undefined}
          onChange={(e) => set(value.slice(0, i) + e.target.value.replace(/\D/g, '').slice(-1) + value.slice(i + 1))}
          onKeyDown={(e) => onKey(i, e)}
          onPaste={onPaste}
          onFocus={(e) => e.target.select()}
          animate={d && !reduce ? { scale: [1, 1.14, 0.96, 1] } : { scale: 1 }}
          transition={{ duration: 0.28, ease: 'easeOut' }}
          className={cn(
            'size-12 rounded-md border bg-card text-center font-mono text-xl font-semibold shadow-xs outline-none transition-colors',
            'focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-ring/40',
            d && 'border-primary/60',
            invalid && 'border-destructive ring-destructive/20',
          )}
        />
      ))}
    </div>
  );
}
