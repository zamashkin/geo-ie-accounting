import path from 'node:path';
import { unitConfig } from '@ie-ledger/config/vitest';
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig, mergeConfig } from 'vitest/config';

// Two projects:
//   unit       pure helpers (money parsing, nav matching) in Node. `pnpm test`.
//   storybook  every story as a test in headless Chromium: renders, runs its play function
//              (interaction test) and runs axe through addon-a11y. `pnpm test:storybook`.
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
