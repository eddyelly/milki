import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SecretReveal } from '@/components/secret-reveal';

/** API keys and one-time passwords are shown once: closing requires confirming they were stored. */
describe('SecretReveal', () => {
  it('shows the secret and only closes after "I have stored it"', () => {
    const onClose = vi.fn();
    render(<SecretReveal open title="API key for CRDB" label="API key" secret="mlk_1a2b3c4d_secret" onClose={onClose} />);
    expect(screen.getByTestId('secret-value')).toHaveTextContent('mlk_1a2b3c4d_secret');
    const done = screen.getByRole('button', { name: 'Done' });
    expect(done).toBeDisabled();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText('I have copied and stored it safely'));
    expect(done).toBeEnabled();
    fireEvent.click(done);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
