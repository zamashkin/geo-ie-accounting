import { geoIeAccounting } from '@geo-ie-accounting/config/eslint';

const PURE =
  'packages/importers is pure and runtime-neutral: parsers take a Uint8Array, not Node APIs.';

export default geoIeAccounting({
  pkg: 'importers',
  root: import.meta.dirname,
  extra: [
    {
      // The tsconfig includes Node types for the tests; keep Node-only globals out of the parsers.
      name: 'importers/no-node-globals',
      files: ['src/**/*.ts'],
      ignores: ['**/*.test.ts', '**/test/**'],
      rules: {
        'no-restricted-globals': [
          'error',
          {
            name: 'parseFloat',
            message: 'Money is bigint minor units. Use lib/decimal, never floats.',
          },
          { name: 'Buffer', message: PURE },
          { name: 'process', message: PURE },
          { name: 'require', message: PURE },
          { name: '__dirname', message: PURE },
        ],
      },
    },
  ],
});
