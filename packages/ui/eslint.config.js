import { ieLedger } from '@ie-ledger/config/eslint';
import jsxA11y from 'eslint-plugin-jsx-a11y-x';
import reactHooks from 'eslint-plugin-react-hooks';
import storybook from 'eslint-plugin-storybook';
import globals from 'globals';

// a11y lint: eslint-plugin-jsx-a11y does not declare ESLint 10 support, so we use its
// maintained fork eslint-plugin-jsx-a11y-x (same rules, ESLint 9/10 flat config). Static
// rules catch only part of the problem; axe runs on every story in `pnpm test:storybook`.
export default ieLedger({
  pkg: 'ui',
  root: import.meta.dirname,
  extra: [
    { ignores: ['storybook-static/**'] },
    {
      name: 'ui/browser',
      files: ['**/*.{ts,tsx}'],
      languageOptions: { globals: { ...globals.browser } },
    },
    reactHooks.configs.flat.recommended,
    {
      ...jsxA11y.configs.strict,
      name: 'ui/jsx-a11y',
      files: ['**/*.tsx'],
      settings: {
        'jsx-a11y-x': {
          // React Aria components render these native elements.
          components: { Button: 'button', ButtonLink: 'a', Input: 'input', Label: 'label' },
        },
      },
    },
    ...storybook.configs['flat/recommended'],
    {
      name: 'ui/stories',
      files: ['**/*.stories.tsx'],
      rules: {
        // Demo data generators and play functions: relaxed rules.
        '@typescript-eslint/no-non-null-assertion': 'off',
        'react-hooks/rules-of-hooks': 'off',
      },
    },
  ],
});
