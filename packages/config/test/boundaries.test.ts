import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';
import { boundaries, forbiddenWorkspaceDeps, SCOPE, WORKSPACE_DEPS } from '../eslint/boundaries.js';
import type { PackageName } from '../eslint/boundaries.js';

const repoRoot = path.resolve(import.meta.dirname, '../../..');

const PACKAGE_DIRS: Record<PackageName, string> = {
  web: 'apps/web',
  api: 'apps/api',
  worker: 'apps/worker',
  contracts: 'packages/contracts',
  domain: 'packages/domain',
  db: 'packages/db',
  importers: 'packages/importers',
  nbg: 'packages/nbg',
  ui: 'packages/ui',
  config: 'packages/config',
};

async function lint(pkg: PackageName, code: string, file = 'src/example.ts') {
  const root = path.join(repoRoot, PACKAGE_DIRS[pkg]);
  const eslint = new ESLint({
    cwd: root,
    overrideConfigFile: true,
    overrideConfig: [
      { files: ['**/*.ts'], languageOptions: { parser: tseslint.parser } },
      ...boundaries(pkg, root),
    ],
  });
  const [result] = await eslint.lintText(code, { filePath: path.join(root, file) });
  return result!.messages.map((m) => m.ruleId);
}

describe('workspace dependency rules (ARCHITECTURE §2)', () => {
  it('web importing db fails lint', async () => {
    expect(await lint('web', "import { schema } from '@ie-ledger/db';\n")).toContain(
      'no-restricted-imports',
    );
  });

  it('web importing a db subpath, or as a type, fails lint', async () => {
    expect(await lint('web', "import type { Db } from '@ie-ledger/db/client';\n")).toContain(
      'no-restricted-imports',
    );
  });

  it('web test files may not import db either', async () => {
    expect(
      await lint('web', "import { schema } from '@ie-ledger/db';\n", 'src/page.test.ts'),
    ).toContain('no-restricted-imports');
  });

  it('contracts tests may use vitest, contracts sources may not', async () => {
    expect(await lint('contracts', "import { it } from 'vitest';\n", 'src/a.test.ts')).toEqual([]);
    expect(await lint('contracts', "import { it } from 'vitest';\n")).toContain(
      'no-restricted-imports',
    );
  });

  it('web importing contracts, ui and domain passes', async () => {
    const code = [
      "import { Money } from '@ie-ledger/contracts';",
      "import { x } from '@ie-ledger/ui';",
      "import { y } from '@ie-ledger/domain';",
      '',
    ].join('\n');
    expect(await lint('web', code)).toEqual([]);
  });

  it('web importing pg or drizzle fails lint', async () => {
    expect(await lint('web', "import pg from 'pg';\n")).toContain('no-restricted-imports');
    expect(await lint('web', "import { eq } from 'drizzle-orm';\n")).toContain(
      'no-restricted-imports',
    );
  });

  it('domain importing anything from the workspace fails lint', async () => {
    expect(await lint('domain', "import { z } from '@ie-ledger/contracts';\n")).toContain(
      'no-restricted-imports',
    );
  });

  it('domain and importers doing I/O fail lint', async () => {
    expect(await lint('domain', "import { readFile } from 'node:fs/promises';\n")).toContain(
      'no-restricted-imports',
    );
    expect(await lint('importers', "import fs from 'fs';\n")).toContain('no-restricted-imports');
    expect(await lint('importers', "import { Pool } from 'pg';\n")).toContain(
      'no-restricted-imports',
    );
  });

  it('contracts may import zod and relative files only', async () => {
    expect(await lint('contracts', "import { z } from 'zod';\nimport { a } from './a';\n")).toEqual(
      [],
    );
    expect(await lint('contracts', "import { a } from 'date-fns';\n")).toContain(
      'no-restricted-imports',
    );
  });

  it('importers importing db fails lint', async () => {
    expect(await lint('importers', "export { schema } from '@ie-ledger/db';\n")).toContain(
      'no-restricted-imports',
    );
  });

  it('relative imports that leave the package fail lint', async () => {
    expect(
      await lint('web', "import { schema } from '../../../packages/db/src/index';\n"),
    ).toContain('ie-ledger/no-cross-package-relative');
    expect(await lint('web', "import { a } from './lib/a';\n")).toEqual([]);
  });

  it('dynamic imports are checked as well', async () => {
    expect(await lint('web', "export const m = () => import('../../../packages/db/src');\n")).toContain(
      'ie-ledger/no-cross-package-relative',
    );
  });
});

describe('package.json dependencies follow the same rules', () => {
  for (const [pkg, dir] of Object.entries(PACKAGE_DIRS) as [PackageName, string][]) {
    const manifest = path.join(repoRoot, dir, 'package.json');
    it(`${dir}/package.json`, () => {
      expect(existsSync(manifest), `${manifest} exists`).toBe(true);
      const json = JSON.parse(readFileSync(manifest, 'utf8')) as Record<
        string,
        Record<string, string> | undefined
      >;
      const deps = Object.keys({
        ...json.dependencies,
        ...json.devDependencies,
        ...json.peerDependencies,
      });
      const forbidden = forbiddenWorkspaceDeps(pkg).map((p) => `${SCOPE}/${p}`);
      expect(deps.filter((d) => forbidden.includes(d))).toEqual([]);
    });
  }

  it('the rule table covers every workspace package', () => {
    const found = ['apps', 'packages'].flatMap((group) =>
      readdirSync(path.join(repoRoot, group)).map((name) => `${group}/${name}`),
    );
    expect(found.sort()).toEqual(Object.values(PACKAGE_DIRS).sort());
    expect(Object.keys(WORKSPACE_DEPS).sort()).toEqual(Object.keys(PACKAGE_DIRS).sort());
  });
});
