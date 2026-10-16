import { expect, type Locator, type Page, test } from '@playwright/test';
import { checkPage, FIXTURE, fillDate, verificationLink } from './support';

// The MVP demo path (docs/MVP.md) against the running stack, with the synthetic BoG fixture:
// sign up, create a workspace, set the SBS start, import, commit, check the June 2025 figures,
// re-import (nothing new), reverse an income line and watch the figures drop.

test.describe.configure({ mode: 'serial' });

const run = Date.now().toString(36);
const email = `e2e-${run}@example.ge`;
const password = 'e2e-password-2026';

function juneRow(page: Page): Locator {
  return page.locator('tr[data-period="2025-06"]');
}

async function expectJune(page: Page, income: string, tax: string) {
  const june = juneRow(page);
  await expect(june.locator('[data-col="income"]')).toHaveText(income);
  await expect(june.locator('[data-col="line-15"]')).toHaveText(income);
  await expect(june.locator('[data-col="line-20"]')).toHaveText(income);
  await expect(june.locator('[data-col="line-18"]')).toHaveText('0.00');
  await expect(june.locator('[data-col="line-19"]')).toHaveText('0.00');
  await expect(june.locator('[data-col="line-21"]')).toHaveText('0.00');
  await expect(june.locator('[data-col="rate"]')).toHaveText('1%');
  await expect(june.locator('[data-col="tax"]')).toHaveText(tax);
  await expect(june.locator('[data-col="deadline"] time')).toHaveAttribute(
    'datetime',
    '2025-07-15',
  );
}

async function upload(page: Page) {
  await page.getByRole('link', { name: 'Imports', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Imports' })).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles(FIXTURE);
  await page.getByRole('button', { name: 'Upload and preview' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'bog-gbp-2025-06.xlsx' })).toBeVisible();
}

test('demo path: sign up to declaration figures', async ({ page }) => {
  await test.step('sign up and verify the email', async () => {
    await page.goto('/sign-in');
    await checkPage(page, 'sign-in');
    await page.getByRole('link', { name: 'Create one' }).click();
    await page.getByLabel('Your name').fill('E2E Entrepreneur');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();

    await page.goto(await verificationLink(email));
    // Verified and signed in, no workspace yet: first-run setup.
    await expect(page).toHaveURL(/\/orgs\/new$/);
  });

  await test.step('create a workspace and set the SBS start date', async () => {
    await expect(page.getByRole('heading', { name: 'Set up your workspace' })).toBeVisible();
    await checkPage(page, 'workspace-create');
    await page.getByLabel('Workspace name').fill(`E2E IE ${run}`);
    await page.getByRole('button', { name: 'Create workspace' }).click();
    await expect(page.getByText('One more detail for the declarations')).toBeVisible();
    await fillDate(page, 'Small-business status start date', '2025-01-01');
    await checkPage(page, 'workspace-sbs-date');
    await page.getByRole('button', { name: 'Save and continue' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
  });

  await test.step('upload the BoG statement and check the preview', async () => {
    await checkPage(page, 'dashboard-empty');
    await upload(page);
    const rows = page.getByRole('table', { name: 'Statement rows' }).getByRole('row');
    await expect(rows).toHaveCount(5); // header + 4 lines
    await expect(page.getByText('4 rows will be booked')).toBeVisible();
    // Incoming payments are suggested as SBS income, conversions go to FX Clearing.
    const incoming = rows.filter({ hasText: 'GBP 1,180.00' });
    await expect(incoming).toContainText('Incoming payment');
    await expect(incoming.getByRole('button', { name: /Account for/ })).toContainText(
      'Income: Services',
    );
    await expect(rows.filter({ hasText: 'Currency exchange' }).first()).toContainText(
      'FX Clearing',
    );
    await checkPage(page, 'import-preview');
  });

  await test.step('skip and restore a row, then commit', async () => {
    const fx = page.getByRole('table', { name: 'Statement rows' }).getByRole('row').filter({
      hasText: 'GBP 489.00',
    });
    await fx.getByRole('button', { name: /^Skip / }).click();
    await expect(page.getByText('3 rows will be booked')).toBeVisible();
    await fx.getByRole('button', { name: /^Include / }).click();
    await expect(page.getByText('4 rows will be booked')).toBeVisible();

    await page.getByRole('button', { name: 'Book 4 transactions' }).click();
    await expect(page.getByText('Booked 4 transactions').first()).toBeVisible();
    await checkPage(page, 'import-committed');
  });

  await test.step('transactions show original amount, GEL and the NBG rate', async () => {
    await page.getByRole('link', { name: 'View transactions' }).click();
    const table = page.getByRole('table', { name: 'Transactions' });
    await expect(table.getByRole('row')).toHaveCount(5);
    await checkPage(page, 'transactions');

    await table.getByRole('row', { name: /11 Jun 2025, GBP 364\.00/ }).click();
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByText('3.6858 GEL per 1 GBP').first()).toBeVisible();
    await expect(sheet.locator('time[datetime="2025-06-11"]').first()).toBeVisible();
    await expect(sheet.getByText('GEL 1,341.63').first()).toBeVisible();
    await checkPage(page, 'transaction-detail');
    await page.keyboard.press('Escape');
  });

  await test.step('June 2025 declaration matches the expected figures', async () => {
    await page.goto(page.url().replace(/\/transactions.*$/, '/declarations?year=2025'));
    await expectJune(page, '5,698.66', '56.99');
    await checkPage(page, 'declarations');

    await page.getByRole('link', { name: 'Dashboard', exact: true }).click();
    await page.getByRole('button', { name: /Year/ }).click();
    await page.getByRole('option', { name: '2025' }).click();
    await expect(page).toHaveURL(/year=2025/);
    await expect(page.getByText('GEL 5,698.66').first()).toBeVisible();
    await checkPage(page, 'dashboard');
  });

  await test.step('re-uploading the same statement books nothing new', async () => {
    await upload(page);
    await expect(page.getByText('Nothing new in this statement')).toBeVisible();
    await expect(page.getByText('All 4 lines are already in the ledger')).toBeVisible();
    await expect(
      page.getByRole('table', { name: 'Statement rows' }).getByText('Already booked'),
    ).toHaveCount(4);
    await checkPage(page, 'import-duplicates');
    await page.getByRole('button', { name: 'Close import' }).click();
    await expect(page.getByText('Booked 0 transactions').first()).toBeVisible();
  });

  await test.step('reversing an income line takes it out of June', async () => {
    await page.getByRole('link', { name: 'Transactions', exact: true }).click();
    const table = page.getByRole('table', { name: 'Transactions' });
    await table.getByRole('row', { name: /11 Jun 2025, GBP 364\.00/ }).click();
    await page.getByRole('button', { name: 'Reverse' }).click();
    const confirm = page.getByRole('alertdialog', { name: 'Reverse this transaction?' });
    await expect(confirm).toBeVisible();
    await checkPage(page, 'transaction-reverse');
    await confirm.getByRole('button', { name: 'Reverse transaction' }).click();
    await expect(page.getByText('Transaction reversed')).toBeVisible();
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByText('This transaction has been reversed.')).toBeVisible();
    await sheet.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(table.getByRole('row')).toHaveCount(6);

    await page.getByRole('link', { name: 'Declarations', exact: true }).click();
    await page.getByRole('button', { name: /Year/ }).click();
    await page.getByRole('option', { name: '2025' }).click();
    await expectJune(page, '4,357.03', '43.57');
  });

  await test.step('workspace settings show the SBS start date', async () => {
    await page.getByRole('link', { name: 'Workspace', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Workspace' })).toBeVisible();
    await checkPage(page, 'settings');
  });

  await test.step('sign out, and back in with the password', async () => {
    await page.getByRole('button', { name: /Account menu/ }).click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/sign-in/);
    await page.getByLabel('Email').fill(email);
    await page.getByRole('textbox', { name: 'Password' }).fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
  });
});
