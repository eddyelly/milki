import type { TicketPriority } from './support.models';

const H = 60 * 60 * 1000;

/** Service levels per priority (first response, resolution). */
export const SLA: Readonly<Record<TicketPriority, { firstResponseMs: number; resolveMs: number }>> = {
  URGENT: { firstResponseMs: 1 * H, resolveMs: 8 * H },
  HIGH: { firstResponseMs: 4 * H, resolveMs: 24 * H },
  NORMAL: { firstResponseMs: 24 * H, resolveMs: 72 * H },
  LOW: { firstResponseMs: 72 * H, resolveMs: 7 * 24 * H },
};

export function dueDates(priority: TicketPriority, from: Date): { firstResponseDueAt: Date; resolveDueAt: Date } {
  const s = SLA[priority];
  return { firstResponseDueAt: new Date(from.getTime() + s.firstResponseMs), resolveDueAt: new Date(from.getTime() + s.resolveMs) };
}

export type SlaState = 'OK' | 'WARNING' | 'BREACHED' | 'MET';

export interface SlaView {
  /** Which clock is running: the first response, then resolution. */
  target: 'FIRST_RESPONSE' | 'RESOLUTION' | 'NONE';
  dueAt: Date | null;
  state: SlaState;
  /** Elapsed share of the window, 0..1+ (accent at 0.75, danger at 1 — §11). */
  elapsed: number;
}

interface SlaInput {
  status: string;
  createdAt: Date;
  firstResponseAt?: Date | null;
  firstResponseDueAt: Date;
  resolveDueAt: Date;
  resolvedAt?: Date | null;
}

export function slaView(t: SlaInput, now = new Date()): SlaView {
  if (t.status === 'RESOLVED' || t.status === 'CLOSED') {
    const met = (t.resolvedAt ?? now) <= t.resolveDueAt;
    return { target: 'NONE', dueAt: null, state: met ? 'MET' : 'BREACHED', elapsed: 1 };
  }
  const first = !t.firstResponseAt;
  const due = first ? t.firstResponseDueAt : t.resolveDueAt;
  // AWAITING_USER pauses nothing here: the resolution clock keeps running, as most public-sector SLAs do.
  const total = Math.max(1, due.getTime() - t.createdAt.getTime());
  const elapsed = (now.getTime() - t.createdAt.getTime()) / total;
  const state: SlaState = elapsed >= 1 ? 'BREACHED' : elapsed >= 0.75 ? 'WARNING' : 'OK';
  return { target: first ? 'FIRST_RESPONSE' : 'RESOLUTION', dueAt: due, state, elapsed: Math.round(elapsed * 1000) / 1000 };
}
