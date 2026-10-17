// Shared ESLint flat config. Each package has an `eslint.config.js` that calls `geoIeAccounting()`.
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { boundaries } from './boundaries.js';

export {
  boundaries,
  WORKSPACE_DEPS,
  FORBIDDEN_MODULES,
  forbiddenWorkspaceDeps,
} from './boundaries.js';

const MONEY_MESSAGE =
  'Money is bigint minor units. Parse decimal strings with the helpers in packages/domain, never with floats.';

/**
 * @param {object} options
 * @param {import('./boundaries.js').PackageName} options.pkg package name without scope
 * @param {string} options.root absolute path of the package (use `import.meta.dirname`)
 * @param {boolean} [options.typeChecked=true] enable type-aware rules
 * @param {import('eslint').Linter.Config[]} [options.extra] package specific entries
 * @returns {import('eslint').Linter.Config[]}
 */
export function geoIeAccounting({ pkg, root, typeChecked = true, extra = [] }) {
  return [
    {
      name: 'geo-ie-accounting/ignores',
      ignores: [
        '**/node_modules/**',
        '**/dist/**',
        '**/.next/**',
        '**/coverage/**',
        '**/.turbo/**',
        '**/*.gen.ts',
        '**/next-env.d.ts',
        'drizzle/**',
      ],
    },
    js.configs.recommended,
    ...(typeChecked ? tseslint.configs.strictTypeChecked : tseslint.configs.strict),
    {
      name: 'geo-ie-accounting/language',
      languageOptions: {
        ecmaVersion: 2024,
        sourceType: 'module',
        globals: { ...globals.node },
        ...(typeChecked ? { parserOptions: { projectService: true, tsconfigRootDir: root } } : {}),
      },
      linterOptions: { reportUnusedDisableDirectives: 'error' },
    },
    {
      name: 'geo-ie-accounting/rules',
      rules: {
        'no-restricted-globals': ['error', { name: 'parseFloat', message: MONEY_MESSAGE }],
        'no-restricted-properties': [
          'error',
          { object: 'Number', property: 'parseFloat', message: MONEY_MESSAGE },
          {
            object: 'Math',
            property: 'round',
            message: 'Rounding money goes through packages/domain.',
          },
        ],
        eqeqeq: ['error', 'always'],
        // Fastify plugins and hooks are async by signature even when they do not await.
        '@typescript-eslint/require-await': 'off',
        'no-console': 'error',
        '@typescript-eslint/consistent-type-imports': 'error',
        '@typescript-eslint/no-unused-vars': [
          'error',
          { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
        ],
        ...(typeChecked
          ? {
              '@typescript-eslint/restrict-template-expressions': [
                'error',
                { allowNumber: true, allowBoolean: true },
              ],
            }
          : {}),
      },
    },
    {
      name: 'geo-ie-accounting/js-files',
      files: ['**/*.{js,mjs,cjs}'],
      ...(typeChecked ? tseslint.configs.disableTypeChecked : {}),
    },
    {
      name: 'geo-ie-accounting/tests',
      files: ['**/*.test.ts', '**/test/**/*.ts'],
      rules: {
        '@typescript-eslint/no-non-null-assertion': 'off',
      },
    },
    ...boundaries(pkg, root),
    ...extra,
    prettier,
  ];
}
