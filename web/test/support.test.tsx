import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StatusBadge } from '@/components/status-badge';
import { MarkdownLite } from '@/components/support/markdown-lite';
import { PriorityBadge, SlaTimer } from '@/components/support/sla';
import { slaText, TICKET_STATUS, TICKET_STATUSES } from '@/lib/support';

const NOW = new Date('2026-01-01T03:00:00Z').getTime();

describe('ticket status badge', () => {
  it.each(TICKET_STATUSES)('%s renders label and icon', (status) => {
    render(<StatusBadge kind="ticket" status={status} />);
    const badge = screen.getByRole('status', { name: `Status: ${TICKET_STATUS[status].label}` });
    expect(badge.querySelector('svg')).not.toBeNull();
  });
});

/** CLAUDE.md §11: the SLA timer turns accent at 75% of the deadline and danger once breached. */
describe('SlaTimer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  const start = '2026-01-01T00:00:00Z';
  const sla = (dueAt: string) => ({ target: 'FIRST_RESPONSE' as const, dueAt, state: 'OK' as const, elapsed: 0 });

  it('is OK below 75%', () => {
    const { container } = render(<SlaTimer sla={sla('2026-01-01T10:00:00Z')} start={start} />);
    expect(container.querySelector('[data-sla]')).toHaveAttribute('data-sla', 'OK');
    expect(screen.getByText('first reply in 7h 0m')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '30');
  });

  it('warns from 75%', () => {
    const { container } = render(<SlaTimer sla={sla('2026-01-01T04:00:00Z')} start={start} />);
    expect(container.querySelector('[data-sla]')).toHaveAttribute('data-sla', 'WARNING');
  });

  it('is breached after the deadline and says by how much', () => {
    const { container } = render(<SlaTimer sla={sla('2026-01-01T02:30:00Z')} start={start} />);
    expect(container.querySelector('[data-sla]')).toHaveAttribute('data-sla', 'BREACHED');
    expect(screen.getByText('first reply overdue 30m')).toBeInTheDocument();
  });

  it('shows "SLA met" for resolved tickets', () => {
    render(<SlaTimer sla={{ target: 'NONE', dueAt: null, state: 'MET', elapsed: 1 }} start={start} />);
    expect(screen.getByText('SLA met')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('formats long windows in days', () => {
    expect(slaText({ target: 'RESOLUTION', dueAt: '2026-01-05T03:00:00Z', state: 'OK', elapsed: 0.1 }, NOW)).toBe('resolution in 4d');
  });
});

describe('PriorityBadge', () => {
  it('shows the label, not just colour', () => {
    render(<PriorityBadge priority="URGENT" />);
    expect(screen.getByText('Urgent')).toBeInTheDocument();
  });
});

describe('MarkdownLite', () => {
  it('renders paragraphs, lists and bold as elements (no HTML injection)', () => {
    const { container } = render(<MarkdownLite text={'Open the **parcel**.\n\n- one\n- two\n\n<script>alert(1)</script>'} />);
    expect(container.querySelector('strong')).toHaveTextContent('parcel');
    expect(container.querySelectorAll('li')).toHaveLength(2);
    expect(container.querySelector('script')).toBeNull();
    expect(container).toHaveTextContent('<script>alert(1)</script>');
  });
});
