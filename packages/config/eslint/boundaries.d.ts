import type { ESLint, Linter } from 'eslint';

export type PackageName =
  | 'web'
  | 'api'
  | 'worker'
  | 'contracts'
  | 'domain'
  | 'db'
  | 'importers'
  | 'nbg'
  | 'ui'
  | 'config';

export declare const SCOPE: '@ie-ledger';
export declare const WORKSPACE_DEPS: Record<PackageName, PackageName[]>;
export declare const FORBIDDEN_MODULES: Partial<
  Record<PackageName, { regex: string; message: string }[]>
>;
export declare function forbiddenWorkspaceDeps(pkg: PackageName): PackageName[];
export declare const plugin: ESLint.Plugin;
export declare function boundaries(pkg: PackageName, packageRoot: string): Linter.Config[];
