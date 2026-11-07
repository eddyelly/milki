import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatusBadge } from '@/components/status-badge';
import { PARCEL_STATUS, TRANSFER_STATUS } from '@/lib/status';
import { PARCEL_STATUSES, TRANSFER_STATUSES } from '@/lib/types';

/** CLAUDE.md §9.1: a status colour is always paired with an icon and a label — never colour alone. */
describe('StatusBadge', () => {
  it.each(PARCEL_STATUSES)('parcel %s renders label, icon and accessible status', (status) => {
    render(<StatusBadge kind="parcel" status={status} />);
    const badge = screen.getByRole('status', { name: `Status: ${PARCEL_STATUS[status].label}` });
    expect(badge).toHaveTextContent(PARCEL_STATUS[status].label);
    expect(badge.querySelector('svg')).not.toBeNull();
    expect(badge).toHaveAttribute('data-status', status);
    expect(badge).toHaveAttribute('title', PARCEL_STATUS[status].description);
  });

  it.each(TRANSFER_STATUSES)('transfer %s renders label and icon', (status) => {
    render(<StatusBadge kind="transfer" status={status} size="sm" />);
    const badge = screen.getByRole('status', { name: `Status: ${TRANSFER_STATUS[status].label}` });
    expect(badge.querySelector('svg')).not.toBeNull();
    expect(badge.className).toContain('text-xs');
  });

  it('uses the §9.1 status colour tokens', () => {
    const expected: Record<string, string> = {
      ACTIVE: '--status-active',
      PENDING_TRANSFER: '--status-pending',
      ENCUMBERED: '--status-encumbered',
      DISPUTED: '--status-disputed',
      FROZEN: '--status-frozen',
      RETIRED: '--status-frozen',
    };
    for (const [status, token] of Object.entries(expected)) {
      expect(PARCEL_STATUS[status as keyof typeof PARCEL_STATUS].color).toBe(`var(${token})`);
    }
    expect(TRANSFER_STATUS.COMPLETED.color).toBe('var(--status-completed)');
    expect(TRANSFER_STATUS.REJECTED.color).toBe('var(--status-rejected)');
    expect(TRANSFER_STATUS.CANCELLED.color).toBe('var(--status-rejected)');
  });

  it('gold statuses use the darker ink for AA-legible text', () => {
    render(<StatusBadge kind="parcel" status="PENDING_TRANSFER" />);
    expect(screen.getByRole('status').getAttribute('style')).toContain('--status-pending-ink');
  });

  it('every status has a Swahili label for parity with mobile', () => {
    for (const m of [...Object.values(PARCEL_STATUS), ...Object.values(TRANSFER_STATUS)]) expect(m.labelSw.length).toBeGreaterThan(1);
  });
});
