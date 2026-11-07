'use client';

import { CircleAlert, Inbox, RotateCw } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function PageHeader({ title, description, actions, eyebrow }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0 space-y-1">
        {eyebrow && <div className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{eyebrow}</div>}
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {description && <p className="text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ title, description, icon, action, className }: { title: string; description?: ReactNode; icon?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed bg-card/50 px-6 py-12 text-center', className)}>
      <span className="grid size-12 place-items-center rounded-full bg-muted text-muted-foreground">{icon ?? <Inbox className="size-6" aria-hidden />}</span>
      <div className="space-y-1">
        <p className="font-semibold">{title}</p>
        {description && <p className="max-w-sm text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry, className }: { error: unknown; onRetry?: () => void; className?: string }) {
  const message = error instanceof Error ? error.message : 'Something went wrong.';
  return (
    <div role="alert" className={cn('flex flex-col items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-6 py-10 text-center', className)}>
      <CircleAlert className="size-8 text-destructive" aria-hidden />
      <p className="max-w-md font-medium">{message}</p>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RotateCw /> Try again
        </Button>
      )}
    </div>
  );
}

/** Label/value list for record details. */
export function Fields({ items, className }: { items: { label: string; value: ReactNode; mono?: boolean }[]; className?: string }) {
  return (
    <dl className={cn('grid gap-x-6 gap-y-4 sm:grid-cols-2', className)}>
      {items.map((i) => (
        <div key={i.label} className="min-w-0">
          <dt className="text-xs font-medium text-muted-foreground">{i.label}</dt>
          <dd className={cn('mt-0.5 truncate font-medium', i.mono && 'font-mono text-sm')}>{i.value ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}
