import { cn } from '@/lib/utils';
import { PARCEL_STATUS, TRANSFER_STATUS } from '@/lib/status';
import { TICKET_STATUS, type TicketStatus } from '@/lib/support';
import type { ParcelStatus, TransferStatus } from '@/lib/types';

type Props =
  | { kind: 'parcel'; status: ParcelStatus; size?: 'sm' | 'md'; className?: string }
  | { kind: 'transfer'; status: TransferStatus; size?: 'sm' | 'md'; className?: string }
  | { kind: 'ticket'; status: TicketStatus; size?: 'sm' | 'md'; className?: string };

/**
 * Status chip: colour + icon + label, never colour alone (CLAUDE.md §9.1).
 * Background is a 12% tint of the status colour so text stays AA-legible in both themes.
 */
export function StatusBadge(props: Props) {
  const meta = props.kind === 'parcel' ? PARCEL_STATUS[props.status] : props.kind === 'transfer' ? TRANSFER_STATUS[props.status] : TICKET_STATUS[props.status];
  if (!meta) return null;
  const Icon = meta.icon;
  const ink = meta.ink ?? meta.color;
  return (
    <span
      role="status"
      aria-label={`Status: ${meta.label}`}
      title={meta.description}
      data-status={props.status}
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full border font-semibold whitespace-nowrap',
        props.size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs',
        props.className,
      )}
      style={{
        color: `color-mix(in oklab, ${ink} 88%, var(--foreground))`,
        backgroundColor: `color-mix(in oklab, ${meta.color} 12%, transparent)`,
        borderColor: `color-mix(in oklab, ${meta.color} 28%, transparent)`,
      }}
    >
      <Icon aria-hidden className="size-3.5" strokeWidth={2.25} />
      {meta.label}
    </span>
  );
}
