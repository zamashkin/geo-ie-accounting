import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

export const FIXTURE = fileURLToPath(
  new URL('../../../fixtures/statements/bog/bog-gbp-2025-06.xlsx', import.meta.url),
);
/** Hand-made BoG CSV: an income line whose GEL is 5 tetri off NBG, and an unclassified fee. */
export const UNASSIGNED_FIXTURE = fileURLToPath(
  new URL('../../../fixtures/statements/bog/synthetic-gbp-2025-06-unassigned.csv', import.meta.url),
);
const SCREENSHOT_DIR = fileURLToPath(new URL('../../../docs/screenshots/', import.meta.url));
const MAILPIT = process.env.E2E_MAILPIT_URL ?? 'http://localhost:8025';
const SCREENSHOTS = process.env.E2E_SCREENSHOTS === '1';

const DESKTOP = { width: 1280, height: 900 };
const PHONE = { width: 360, height: 780 };

/** The verification link Better Auth mailed to `email` (through Mailpit). */
export async function verificationLink(email: string): Promise<string> {
  let link: string | undefined;
  await expect
    .poll(
      async () => {
        const search = await fetch(
          `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`,
        );
        const { messages } = (await search.json()) as { messages: { ID: string }[] };
        const id = messages[0]?.ID;
        if (!id) return null;
        const message = (await (await fetch(`${MAILPIT}/api/v1/message/${id}`)).json()) as {
          Text: string;
        };
        link = /https?:\/\/\S+/.exec(message.Text)?.[0];
        return link ?? null;
      },
      { message: `verification email to ${email}`, timeout: 15_000 },
    )
    .not.toBeNull();
  return link as string;
}

async function axe(page: Page, name: string) {
  // Colour contrast is meaningless halfway through a fade-in: let entry animations finish.
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => a.playState !== 'running'),
  );
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    // The Next.js dev tools indicator (next dev only) is not part of the app.
    .exclude('nextjs-portal')
    // React Aria's live announcer: transient, visually hidden `role="img"` nodes that point at
    // the label being announced (removed after a few seconds). Not page content.
    .exclude('[role="log"] > [role="img"]')
    .analyze();
  const summary = results.violations.map(
    (v) => `${v.id} (${v.impact ?? 'n/a'}): ${v.nodes.map((n) => n.html).join(' | ')}`,
  );
  expect(summary, `axe violations on ${name}`).toEqual([]);
}

/**
 * Per page: axe at 1280px and 360px, no horizontal page scroll at 360px (tables scroll inside
 * their own container), and with E2E_SCREENSHOTS=1 a full-page screenshot at both widths.
 */
export async function checkPage(page: Page, name: string) {
  await page.setViewportSize(DESKTOP);
  await page.waitForLoadState('networkidle');
  await axe(page, `${name} @1280`);
  if (SCREENSHOTS)
    await page.screenshot({ path: `${SCREENSHOT_DIR}${name}-1280.png`, fullPage: true });

  await page.setViewportSize(PHONE);
  await expect
    .poll(
      () =>
        page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      { message: `${name} scrolls horizontally at 360px` },
    )
    .toBeLessThanOrEqual(0);
  await axe(page, `${name} @360`);
  if (SCREENSHOTS)
    await page.screenshot({ path: `${SCREENSHOT_DIR}${name}-360.png`, fullPage: true });
  await page.setViewportSize(DESKTOP);
}

/** Types an ISO date into a React Aria date field (en-GB: day, month, year). */
export async function fillDate(page: Page, label: string, iso: string) {
  const [y, m, d] = iso.split('-');
  const group = page.getByRole('group', { name: label });
  await group.getByRole('spinbutton').first().click();
  await page.keyboard.type(`${d}${m}${y}`);
}

/**
 * Signs up through the UI, follows the emailed link, creates a workspace and sets the SBS start
 * date. Ends on the dashboard.
 */
export async function signUpWithWorkspace(
  page: Page,
  { email, password, workspace }: { email: string; password: string; workspace: string },
) {
  await page.goto('/sign-up');
  await page.getByLabel('Your name').fill('E2E Entrepreneur');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  await page.goto(await verificationLink(email));
  await expect(page).toHaveURL(/\/orgs\/new$/);
  await page.getByLabel('Workspace name').fill(workspace);
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page.getByText('One more detail for the declarations')).toBeVisible();
  await fillDate(page, 'Small-business status start date', '2025-01-01');
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
}
