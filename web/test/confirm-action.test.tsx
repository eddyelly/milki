import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmAction, type ConfirmContext } from '@/components/confirm-action';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api';

const send = vi.fn();
const waitForCommit = vi.fn();

vi.mock('@/lib/api', async (orig) => ({ ...(await orig<typeof import('@/lib/api')>()), send: (...a: unknown[]) => send(...a) }));
vi.mock('@/lib/socket', () => ({ useLedgerSocket: () => ({ connected: true, waitForCommit, subscribe: () => () => undefined }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

beforeEach(() => {
  send.mockReset();
  waitForCommit.mockReset();
});

describe('ConfirmAction — T1 standard', () => {
  it('shows the summary, confirms with an idempotency key, then closes', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn().mockResolvedValue({ ok: true });
    const onSuccess = vi.fn();
    render(
      <ConfirmAction tier="T1" title="Save profile" trigger={<Button>Save</Button>} impact={[{ label: 'Language', value: 'Kiswahili' }]} onConfirm={onConfirm} onSuccess={onSuccess} />,
    );
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('alertdialog')).toHaveAttribute('data-tier', 'T1');
    expect(screen.getByText('Kiswahili')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith({ ok: true }));
    expect(onConfirm.mock.calls[0]?.[0].idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(onConfirm.mock.calls[0]?.[0].reauthToken).toBeUndefined();
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  });

  it('shows the API’s human-readable error and stays open', async () => {
    const user = userEvent.setup();
    render(
      <ConfirmAction tier="T1" title="Save" trigger={<Button>Open</Button>} onConfirm={() => Promise.reject(new ApiError(409, 'CONFLICT', 'That email is already in use.'))} />,
    );
    await user.click(screen.getByRole('button', { name: 'Open' }));
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That email is already in use.');
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });
});

describe('ConfirmAction — T2 destructive', () => {
  it('stays disabled until the identifier is typed exactly, and states consequences', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(
      <ConfirmAction
        tier="T2"
        title="Revoke API key"
        trigger={<Button>Revoke</Button>}
        consequences={['The bank’s integration stops working immediately.']}
        typeToConfirm="REVOKE"
        confirmLabel="Revoke key"
        onConfirm={onConfirm}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Revoke' }));
    expect(screen.getByText('The bank’s integration stops working immediately.')).toBeInTheDocument();
    const confirm = screen.getByRole('button', { name: 'Revoke key' });
    expect(confirm).toBeDisabled();
    await user.type(screen.getByLabelText(/Type .* to confirm/), 'revoke');
    expect(confirm).toBeDisabled();
    await user.clear(screen.getByLabelText(/Type .* to confirm/));
    await user.type(screen.getByLabelText(/Type .* to confirm/), 'REVOKE');
    expect(confirm).toBeEnabled();
    expect(confirm.className).toContain('destructive');
    await user.click(confirm);
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
  });
});

describe('ConfirmAction — T3 ledger', () => {
  const setup = (onConfirm: (ctx: ConfirmContext) => Promise<unknown>, extra: Partial<Parameters<typeof ConfirmAction>[0]> = {}) =>
    render(
      <ConfirmAction
        tier="T3"
        title="Approve transfer"
        trigger={<Button>Approve</Button>}
        impactSentence="Ownership of DSM-KIN-12-45 will move from Asha M. to Juma H."
        onConfirm={onConfirm}
        {...extra}
      />,
    );

  it('review → permanent warning → re-auth → submit → sealed with the block number', async () => {
    const user = userEvent.setup();
    send.mockResolvedValueOnce({ reauthToken: 'reauth-123', expiresIn: 300 });
    const onConfirm = vi.fn().mockResolvedValue({ txId: 'a'.repeat(64), status: 'SUBMITTED' });
    waitForCommit.mockResolvedValue({ txId: 'a'.repeat(64), status: 'COMMITTED', blockNumber: 42 });
    setup(onConfirm);

    await user.click(screen.getByRole('button', { name: 'Approve' }));
    expect(screen.getByTestId('impact-sentence')).toHaveTextContent('Ownership of DSM-KIN-12-45 will move from Asha M. to Juma H.');
    expect(screen.getByText(/permanent and publicly auditable/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(screen.getByRole('alertdialog')).toHaveTextContent('Confirm it’s you');
    const sign = screen.getByRole('button', { name: 'Sign and record' });
    expect(sign).toBeDisabled();
    await user.type(screen.getByLabelText('Password'), 'Milki@2026');
    await user.click(sign);

    expect(await screen.findByText(/Sealed on the ledger in block #42/)).toBeInTheDocument();
    expect(send).toHaveBeenCalledWith('post', '/auth/reauth', { password: 'Milki@2026' });
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ reauthToken: 'reauth-123' }));
    expect(waitForCommit).toHaveBeenCalledWith('a'.repeat(64));
    expect(screen.getByRole('button', { name: 'Done' })).toBeEnabled();
  });

  it('a chaincode guard error returns to review with the readable message; the retry reuses the idempotency key', async () => {
    const user = userEvent.setup();
    send.mockResolvedValue({ reauthToken: 'r1', expiresIn: 300 });
    const onConfirm = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(409, 'PARCEL_ENCUMBERED', 'This parcel has an active mortgage with CRDB Bank.'))
      .mockResolvedValueOnce({ txId: 'b'.repeat(64), status: 'SUBMITTED' });
    waitForCommit.mockResolvedValue({ txId: 'b'.repeat(64), status: 'COMMITTED', blockNumber: 7 });
    setup(onConfirm);

    await user.click(screen.getByRole('button', { name: 'Approve' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.type(screen.getByLabelText('Password'), 'pw');
    await user.click(screen.getByRole('button', { name: 'Sign and record' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This parcel has an active mortgage with CRDB Bank.');
    expect(screen.getByTestId('impact-sentence')).toBeInTheDocument(); // back on the review step

    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.type(screen.getByLabelText('Password'), 'pw');
    await user.click(screen.getByRole('button', { name: 'Sign and record' }));
    expect(await screen.findByText(/block #7/)).toBeInTheDocument();
    expect(onConfirm.mock.calls[0]?.[0].idempotencyKey).toBe(onConfirm.mock.calls[1]?.[0].idempotencyKey);
  });

  it('wrong password is shown on the re-auth step and nothing is submitted', async () => {
    const user = userEvent.setup();
    send.mockRejectedValueOnce(new ApiError(401, 'INVALID_CREDENTIALS', 'That password is not correct.'));
    const onConfirm = vi.fn();
    setup(onConfirm);
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.type(screen.getByLabelText('Password'), 'nope');
    await user.click(screen.getByRole('button', { name: 'Sign and record' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That password is not correct.');
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('can re-authenticate with an SMS code instead of the password', async () => {
    const user = userEvent.setup();
    send.mockResolvedValueOnce({ challengeId: 'ch_1234567890', sentTo: '+255•••••001', expiresIn: 300 }).mockResolvedValueOnce({ reauthToken: 'r2', expiresIn: 300 });
    const onConfirm = vi.fn().mockResolvedValue({ txId: 'c'.repeat(64), status: 'SUBMITTED' });
    waitForCommit.mockResolvedValue({ txId: 'c'.repeat(64), status: 'COMMITTED', blockNumber: 3 });
    setup(onConfirm);
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('button', { name: /Use a code sent to my phone/ }));
    await user.click(screen.getByRole('button', { name: /Send a code/ }));
    expect(await screen.findByText(/Enter the code sent to \+255•••••001/)).toBeInTheDocument();
    await user.type(screen.getByLabelText('Digit 1'), '123456');
    await user.click(screen.getByRole('button', { name: 'Sign and record' }));
    expect(await screen.findByText(/block #3/)).toBeInTheDocument();
    expect(send).toHaveBeenLastCalledWith('post', '/auth/reauth', { challengeId: 'ch_1234567890', code: '123456' });
  });

  it('typed confirmation also gates destructive ledger actions (reject)', async () => {
    const user = userEvent.setup();
    setup(vi.fn(), { typeToConfirm: 'TRF-0123456789ABCDEF', title: 'Reject transfer' });
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
    await user.type(screen.getByLabelText(/Type .* to confirm/), 'TRF-0123456789ABCDEF');
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled();
  });

  it('a failed commit shows the failure stage, not success', async () => {
    const user = userEvent.setup();
    send.mockResolvedValueOnce({ reauthToken: 'r3', expiresIn: 300 });
    const onSuccess = vi.fn();
    waitForCommit.mockRejectedValue(new Error('The ledger rejected this transaction. Nothing was changed.'));
    setup(vi.fn().mockResolvedValue({ txId: 'd'.repeat(64), status: 'SUBMITTED' }), { onSuccess });
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.type(screen.getByLabelText('Password'), 'pw');
    await user.click(screen.getByRole('button', { name: 'Sign and record' }));
    expect(await screen.findByText('The ledger rejected this transaction. Nothing was changed.')).toBeInTheDocument();
    expect(onSuccess).not.toHaveBeenCalled();
  });
});
