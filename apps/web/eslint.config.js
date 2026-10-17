import nextPlugin from '@next/eslint-plugin-next';
import { geoIeAccounting } from '@geo-ie-accounting/config/eslint';
import jsxA11y from 'eslint-plugin-jsx-a11y-x';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

// eslint-config-next is not used: it bundles eslint-plugin-react and jsx-a11y, which do not
// declare ESLint 10 support yet. The Next and React Hooks rule sets are added directly, and
// a11y rules come from eslint-plugin-jsx-a11y-x, the maintained fork that supports ESLint 10
// (ADR 0009). axe in Storybook covers what static rules cannot.
export default geoIeAccounting({
  pkg: 'web',
  root: import.meta.dirname,
  extra: [
    {
      name: 'web/next',
      files: ['**/*.{ts,tsx}'],
      plugins: { '@next/next': nextPlugin },
      rules: {
        ...nextPlugin.configs.recommended.rules,
        ...nextPlugin.configs['core-web-vitals'].rules,
      },
      languageOptions: { globals: { ...globals.browser } },
    },
    reactHooks.configs.flat.recommended,
    {
      ...jsxA11y.configs.recommended,
      name: 'web/jsx-a11y',
      files: ['**/*.tsx'],
    },
  ],
});
