import { expect, type Page, test } from '@playwright/test';
import { ACCOUNTS, otpFor, PASSWORD, prepareAcceptedTransfer, publicVerify } from './api';

/**
 * CLAUDE.md §13 phase 10 — end-to-end transfer on the live stack:
 * landowners (mobile app, via the API) register → initiate → accept → upload the TRA receipt;
 * a land officer confirms payments and verifies, and a registrar approves, in the portal (T3 each);
 * public QR verification then shows the buyer as owner, read from the ledger.
 */
async function signIn(page: Page, who: 'officer' | 'registrar', next: string) {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel('Email or phone number').fill(ACCOUNTS[who].email);
  await page.getByLabel('Password').fill(PASSWORD);
  const since = Date.now() - 1000;
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText(/We sent a 6-digit code/)).toBeVisible();
  const code = await otpFor(ACCOUNTS[who].phone, since);
  await page.getByLabel('Digit 1').click();
  await page.keyboard.type(code);
  await expect(page).toHaveURL(new RegExp(`${next}$`));
}

/** Review → re-authenticate with the password → wait for the seal → Done. */
async function signAndSeal(page: Page, confirmLabel: string) {
  const dialog = page.getByRole('alertdialog');
  await expect(dialog.getByText(/permanent and publicly auditable/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Continue' }).click();
  await dialog.getByLabel('Password').fill(PASSWORD);
  await dialog.getByRole('button', { name: confirmLabel }).click();
  await expect(dialog.getByText(/Sealed on the ledger in block #\d+/)).toBeVisible({ timeout: 90_000 });
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).toBeHidden();
}

test('full transfer: initiate → accept → payments → verify → approve → ownership moves', async ({ browser }) => {
  const { parcelId, transferId } = await prepareAcceptedTransfer();
  const before = await publicVerify(parcelId);
  expect(before).toMatchObject({ owner: 'Asha M.', status: 'PENDING_TRANSFER' });

  // Land officer: confirm payments against the buyer's receipt, then verify.
  const officerCtx = await browser.newContext();
  const officer = await officerCtx.newPage();
  await signIn(officer, 'officer', `/transfers/${transferId}`);
  await expect(officer.getByRole('status', { name: 'Status: Buyer accepted' }).first()).toBeVisible();
  await officer.getByRole('button', { name: 'Confirm payments' }).click();
  await officer.getByRole('alertdialog').getByLabel('Payment / TRA reference').fill('TRA-E2E-FULL-01');
  await signAndSeal(officer, 'Sign and record');
  await expect(officer.getByRole('status', { name: 'Status: Payments confirmed' }).first()).toBeVisible({ timeout: 30_000 });

  await officer.getByRole('button', { name: 'Verify' }).click();
  await signAndSeal(officer, 'Sign and record');
  await expect(officer.getByRole('status', { name: 'Status: Officer verified' }).first()).toBeVisible({ timeout: 30_000 });
  await officerCtx.close();

  // Registrar: final approval moves ownership.
  const registrarCtx = await browser.newContext();
  const registrar = await registrarCtx.newPage();
  await signIn(registrar, 'registrar', `/transfers/${transferId}`);
  await registrar.getByRole('button', { name: 'Approve' }).click();
  await expect(registrar.getByRole('alertdialog').getByTestId('impact-sentence')).toContainText(`Ownership of ${parcelId} will move from Asha M. to Juma H.`);
  await signAndSeal(registrar, 'Sign and approve');
  await expect(registrar.getByRole('status', { name: 'Status: Completed' }).first()).toBeVisible({ timeout: 30_000 });
  await registrarCtx.close();

  // Anyone scanning the title QR now sees the new owner, straight from the ledger.
  await expect.poll(async () => (await publicVerify(parcelId)).owner, { timeout: 30_000 }).toBe('Juma H.');
  const after = await publicVerify(parcelId);
  expect(after.status).toBe('ACTIVE');
  expect(after.ownershipVersion).toBe(before.ownershipVersion + 1);
});
