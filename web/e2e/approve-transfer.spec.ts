import { expect, test } from '@playwright/test';
import { ACCOUNTS, otpFor, PASSWORD, prepareVerifiedTransfer } from './api';

/** CLAUDE.md §14: Playwright smoke test of login → approve transfer, on the live stack. */
test('registrar signs in with SMS code and approves a verified transfer', async ({ page }) => {
  const { parcelId, transferId } = await prepareVerifiedTransfer();

  // Sign in: password, then the 6-digit code (read from Mailpit).
  await page.goto(`/login?next=/transfers/${transferId}`);
  await page.getByLabel('Email or phone number').fill(ACCOUNTS.registrar.email);
  await page.getByLabel('Password').fill(PASSWORD);
  const since = Date.now() - 1000;
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText(/We sent a 6-digit code/)).toBeVisible();
  const code = await otpFor(ACCOUNTS.registrar.phone, since);
  await page.getByLabel('Digit 1').click();
  await page.keyboard.type(code);

  // Lands on the transfer, waiting for the registrar.
  await expect(page).toHaveURL(new RegExp(`/transfers/${transferId}$`));
  await expect(page.getByRole('status', { name: 'Status: Officer verified' }).first()).toBeVisible();
  await expect(page.getByText(/142,000,000/)).toBeVisible(); // private sale price, visible to registrars

  // T3: review → re-auth → sealed on the ledger.
  await page.getByRole('button', { name: 'Approve' }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog.getByTestId('impact-sentence')).toContainText(`Ownership of ${parcelId} will move from Asha M. to Juma H.`);
  await expect(dialog.getByText(/permanent and publicly auditable/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Continue' }).click();
  await dialog.getByLabel('Password').fill(PASSWORD);
  await dialog.getByRole('button', { name: 'Sign and approve' }).click();
  await expect(dialog.getByText(/Sealed on the ledger in block #\d+/)).toBeVisible({ timeout: 90_000 });
  await dialog.getByRole('button', { name: 'Done' }).click();

  // The ledger now shows the transfer completed and the buyer as owner.
  await expect(page.getByRole('status', { name: 'Status: Completed' }).first()).toBeVisible();
  await page.goto(`/parcels/${parcelId}`);
  await expect(page.getByText('Juma Hassan').first()).toBeVisible();
  await expect(page.getByRole('status', { name: 'Status: Active' }).first()).toBeVisible();
});
