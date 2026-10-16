import { expect, test } from '@playwright/test';
import { checkPage, signUpWithWorkspace, UNASSIGNED_FIXTURE } from './support';

// Commit with a row that has no suggested account (422), then book it and see the bank-GEL
// warning. Uses the hand-made statement in fixtures/statements/bog/ (no real data).

const run = Date.now().toString(36);

test('a row without an account blocks booking until one is picked', async ({ page }) => {
  await signUpWithWorkspace(page, {
    email: `e2e-unassigned-${run}@example.ge`,
    password: 'e2e-password-2026',
    workspace: `E2E Fees ${run}`,
  });

  await page.getByRole('link', { name: 'Imports', exact: true }).click();
  await page.locator('input[type="file"]').setInputFiles(UNASSIGNED_FIXTURE);
  await page.getByRole('button', { name: 'Upload and preview' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'synthetic-gbp-2025-06-unassigned.csv' }),
  ).toBeVisible();

  const table = page.getByRole('table', { name: 'Statement rows' });
  const fee = table.getByRole('row').filter({ hasText: 'Monthly account service fee' });
  await expect(fee.getByRole('button', { name: /Account for/ })).toContainText('Choose account');

  await test.step('booking is refused with the row highlighted', async () => {
    await page.getByRole('button', { name: 'Book 2 transactions' }).click();
    const notice = page.getByRole('alert').filter({ hasText: 'Some rows have no account' });
    await expect(notice).toContainText('One row needs an account before booking.');
    await expect(fee).toContainText('Pick an account');
    await checkPage(page, 'import-unassigned');
  });

  await test.step('picking an account books both rows, with a bank GEL warning', async () => {
    await fee.getByRole('button', { name: /Account for/ }).click();
    await page.getByRole('option', { name: /Expenses: Bank Fees/ }).click();
    await expect(fee).not.toContainText('Pick an account');
    await page.getByRole('button', { name: 'Book 2 transactions' }).click();
    await expect(page.getByText('Booked 2 transactions').first()).toBeVisible();

    const warning = page
      .getByRole('status')
      .filter({ hasText: "One line differs from the bank's GEL amount" });
    await expect(warning).toContainText('booked GEL 923.10, statement says GEL 923.15');
    await checkPage(page, 'import-gel-warning');
  });
});
