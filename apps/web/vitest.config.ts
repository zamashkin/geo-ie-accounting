import { fileURLToPath } from 'node:url';
import { unitConfig } from '@ie-ledger/config/vitest';
import { defineConfig, mergeConfig } from 'vitest/config';

export default mergeConfig(
  unitConfig,
  defineConfig({
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  }),
);
