import path from 'node:path';
import { unitConfig } from '@ie-ledger/config/vitest';
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig, mergeConfig } from 'vitest/config';

// Two projects:
//   unit       pure helpers (money parsing, nav matching) in Node. `pnpm test`.
//   storybook  every story as a test in headless Chromium: renders it, runs its play function
//              (interaction test) and axe through addon-a11y. `pnpm test:storybook`.
//              Stories pick a viewport with `globals.viewport` (e.g. the 360px shell story).
export default defineConfig({
  test: {
    projects: [
      mergeConfig(unitConfig, { test: { name: 'unit', environment: 'node' } }),
      {
        plugins: [storybookTest({ configDir: path.join(import.meta.dirname, '.storybook') })],
        test: {
          name: 'storybook',
          browser: {
            enabled: true,
            headless: true,
            provider: playwright({}),
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
  },
});
