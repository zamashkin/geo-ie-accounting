import { expect, test } from '@playwright/test';
import { fillDate, signUpWithWorkspace } from './support';

// `/` reopens the workspace the user had open last, not always the first membership.

const run = Date.now().toString(36);

test('the home page reopens the last-used workspace', async ({ page }) => {
  await signUpWithWorkspace(page, {
    email: `e2e-workspaces-${run}@example.ge`,
    password: 'e2e-password-2026',
    workspace: `E2E First ${run}`,
  });
  const first = new URL(page.url()).pathname;

  await page.goto('/orgs/new');
  await page.getByLabel('Workspace name').fill(`E2E Second ${run}`);
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await fillDate(page, 'Small-business status start date', '2025-01-01');
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
  const second = new URL(page.url()).pathname;
  expect(second).not.toBe(first);

  await page.goto('/');
  await expect(page).toHaveURL(new RegExp(`${second}$`));

  await page.goto(first);
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
  await page.goto('/');
  await expect(page).toHaveURL(new RegExp(`${first}$`));
});
