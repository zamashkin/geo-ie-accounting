import { unitConfig } from '@ie-ledger/config/vitest';
import { defineConfig, mergeConfig } from 'vitest/config';

// The domain is the money and tax core: `pnpm test` enforces coverage (WS-01 acceptance: ≥ 95%).
export default mergeConfig(
  unitConfig,
  defineConfig({
    test: {
      coverage: {
        enabled: true,
        provider: 'v8',
        include: ['src/**/*.ts'],
        exclude: ['src/**/*.test.ts', 'src/index.ts'],
        reporter: ['text-summary', 'text'],
        thresholds: { lines: 95, statements: 95, functions: 95, branches: 90 },
      },
    },
  }),
);
