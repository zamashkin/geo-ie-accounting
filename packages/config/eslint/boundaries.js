// Package dependency rules from docs/ARCHITECTURE.md §2, enforced by ESLint.
//
// Three checks per workspace package:
//   1. `@geo-ie-accounting/*` imports must be in the package's allow-list (WORKSPACE_DEPS).
//   2. Some packages may not import certain third-party modules (FORBIDDEN_MODULES),
//      e.g. `domain` and `importers` do no I/O, `contracts` imports nothing but zod.
//   3. Relative imports may not leave the package root (`geo-ie-accounting/no-cross-package-relative`).
//
// The same table is checked against every package.json by the config package's tests.
import path from 'node:path';

/** @typedef {'web'|'api'|'worker'|'contracts'|'domain'|'db'|'importers'|'nbg'|'ui'|'config'} PackageName */

export const SCOPE = '@geo-ie-accounting';

/**
 * Which workspace packages each package may depend on.
 * `nbg` and `ui` are not listed in ARCHITECTURE §2; the entries here are recorded in ADR 0001.
 * `api -> importers` is the MVP's synchronous import (ADR 0012).
 * @type {Record<PackageName, PackageName[]>}
 */
export const WORKSPACE_DEPS = {
  web: ['contracts', 'ui', 'domain'],
  api: ['contracts', 'domain', 'db', 'importers', 'nbg'],
  worker: ['contracts', 'domain', 'db', 'importers', 'nbg'],
  db: ['domain', 'contracts'],
  importers: ['contracts', 'domain'],
  nbg: ['contracts', 'domain'],
  ui: ['domain'],
  domain: [],
  contracts: [],
  config: [],
};

/** Every package may use the shared tooling config. */
const ALWAYS_ALLOWED = ['config'];

const IO_MODULES = [
  'fs',
  'fs/promises',
  'net',
  'http',
  'https',
  'http2',
  'child_process',
  'dgram',
  'dns',
  'tls',
  'worker_threads',
  'cluster',
];

const DB_AND_NETWORK_LIBS = ['pg', 'pg-boss', 'drizzle-orm', 'postgres', 'undici', 'axios'];

/**
 * Third-party modules a package must not import, as regular expressions on the specifier.
 * @type {Partial<Record<PackageName, { regex: string; message: string }[]>>}
 */
export const FORBIDDEN_MODULES = {
  domain: [
    {
      regex: `^(node:)?(${IO_MODULES.join('|')})(/.*)?$`,
      message: 'packages/domain is pure: no I/O.',
    },
    {
      regex: `^(${DB_AND_NETWORK_LIBS.join('|')})(/.*)?$`,
      message: 'packages/domain is pure: no database or network clients.',
    },
  ],
  importers: [
    {
      regex: `^(node:)?(${IO_MODULES.join('|')})(/.*)?$`,
      message: 'packages/importers is pure: parsers take bytes, they do no I/O.',
    },
    {
      regex: `^(${DB_AND_NETWORK_LIBS.join('|')})(/.*)?$`,
      message: 'packages/importers is pure: no database or network clients.',
    },
  ],
  contracts: [
    {
      // Anything that is not zod, a relative import or a type-only node builtin.
      regex: '^(?!zod$|zod/|\\.{1,2}/)',
      message: 'packages/contracts depends on nothing but zod.',
    },
  ],
  web: [
    {
      regex: `^(${DB_AND_NETWORK_LIBS.filter((m) => m !== 'undici' && m !== 'axios').join('|')})(/.*)?$`,
      message: 'apps/web never talks to the database. Go through the API.',
    },
  ],
  ui: [
    {
      regex: `^(${DB_AND_NETWORK_LIBS.join('|')})(/.*)?$`,
      message: 'packages/ui holds components only.',
    },
  ],
};

const ALL_PACKAGES = /** @type {PackageName[]} */ (Object.keys(WORKSPACE_DEPS));

/**
 * @param {PackageName} pkg
 * @returns {PackageName[]}
 */
export function forbiddenWorkspaceDeps(pkg) {
  const allowed = new Set([pkg, ...WORKSPACE_DEPS[pkg], ...ALWAYS_ALLOWED]);
  return ALL_PACKAGES.filter((p) => !allowed.has(p));
}

/** @type {import('eslint').Rule.RuleModule} */
const noCrossPackageRelative = {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow relative imports that leave the package root.' },
    schema: [{ type: 'object', properties: { root: { type: 'string' } }, required: ['root'] }],
    messages: {
      escape:
        "Relative import '{{source}}' leaves this package. Import the other package by name ({{scope}}/...) if the dependency rules allow it.",
    },
  },
  create(context) {
    const root = path.resolve(/** @type {{ root: string }} */ (context.options[0]).root);
    /** @param {import('eslint').Rule.Node & { source?: { value?: unknown } | null | undefined }} node */
    const check = (node) => {
      const source = node.source?.value;
      if (typeof source !== 'string' || !source.startsWith('.')) return;
      const target = path.resolve(path.dirname(context.filename), source);
      const rel = path.relative(root, target);
      if (rel.startsWith('..') || path.isAbsolute(rel)) {
        context.report({ node, messageId: 'escape', data: { source, scope: SCOPE } });
      }
    };
    return {
      ImportDeclaration: check,
      ExportAllDeclaration: check,
      ExportNamedDeclaration: check,
      ImportExpression: check,
    };
  },
};

export const plugin = {
  meta: { name: 'geo-ie-accounting' },
  rules: { 'no-cross-package-relative': noCrossPackageRelative },
};

/**
 * ESLint flat-config entries enforcing the dependency rules for one package.
 * @param {PackageName} pkg
 * @param {string} packageRoot absolute path of the package directory
 * @returns {import('eslint').Linter.Config[]}
 */
export function boundaries(pkg, packageRoot) {
  if (!(pkg in WORKSPACE_DEPS)) throw new Error(`Unknown package '${pkg}' in boundaries()`);
  const forbidden = forbiddenWorkspaceDeps(pkg);
  /** @type {{ regex: string; message: string }[]} */
  const workspacePatterns =
    forbidden.length > 0
      ? [
          {
            regex: `^${SCOPE}/(${forbidden.join('|')})(/.*)?$`,
            message: `${pkg} may only depend on: ${WORKSPACE_DEPS[pkg].join(', ') || '(nothing)'} (ARCHITECTURE §2).`,
          },
        ]
      : [];
  const modulePatterns = FORBIDDEN_MODULES[pkg] ?? [];
  return [
    {
      // Every file, tests and tooling included: workspace rules and package roots.
      name: `geo-ie-accounting/boundaries/${pkg}`,
      plugins: { 'geo-ie-accounting': plugin },
      rules: {
        'no-restricted-imports': ['error', { patterns: workspacePatterns }],
        'geo-ie-accounting/no-cross-package-relative': ['error', { root: packageRoot }],
      },
    },
    {
      // Production sources: also the third-party restrictions (purity, no DB in web, ...).
      // Tests and config files may use vitest, node:fs for fixtures, and so on.
      name: `geo-ie-accounting/boundaries/${pkg}/sources`,
      files: ['src/**/*.{ts,tsx,js,mjs}', 'app/**/*.{ts,tsx}'],
      ignores: ['**/*.test.{ts,tsx}', '**/*.int.test.ts', '**/test/**'],
      rules: {
        'no-restricted-imports': ['error', { patterns: [...workspacePatterns, ...modulePatterns] }],
      },
    },
  ];
}
