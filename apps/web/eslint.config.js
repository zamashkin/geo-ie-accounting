import nextPlugin from '@next/eslint-plugin-next';
import { ieLedger } from '@ie-ledger/config/eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

// eslint-config-next is not used: it bundles eslint-plugin-react and jsx-a11y, which do not
// declare ESLint 10 support yet. The Next and React Hooks rule sets are added directly.
export default ieLedger({
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
  ],
});
