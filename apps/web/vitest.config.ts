import { fileURLToPath } from 'node:url';
import { unitConfig } from '@geo-ie-accounting/config/vitest';
import { defineConfig, mergeConfig } from 'vitest/config';

export default mergeConfig(
  unitConfig,
  defineConfig({
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
    // Route-local view models are tested next to their pages. e2e/ is Playwright's.
    test: { include: ['app/**/*.test.ts'] },
  }),
);
