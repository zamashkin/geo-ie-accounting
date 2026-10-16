import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests against the running local stack (`docker compose up`, `pnpm db:migrate`,
 * `pnpm db:seed`, `pnpm dev`). Nothing is started here: the suite drives the real web app,
 * API, Postgres and Mailpit. `localhost`, not 127.0.0.1, so the API's session cookie is
 * shared with the web app (ADR 0011).
 *
 *   pnpm e2e                      # the demo path
 *   E2E_SCREENSHOTS=1 pnpm e2e    # also writes docs/screenshots/*.png
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  outputDir: './e2e/.results',
  use: {
    baseURL: process.env.E2E_WEB_URL ?? 'http://localhost:3000',
    locale: 'en-GB',
    timezoneId: 'Asia/Tbilisi',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
  ],
});
