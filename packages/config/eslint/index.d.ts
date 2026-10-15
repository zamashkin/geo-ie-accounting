import type { Linter } from 'eslint';
import type { PackageName } from './boundaries.js';

export {
  boundaries,
  WORKSPACE_DEPS,
  FORBIDDEN_MODULES,
  forbiddenWorkspaceDeps,
  type PackageName,
} from './boundaries.js';

export declare function ieLedger(options: {
  pkg: PackageName;
  root: string;
  typeChecked?: boolean;
  extra?: Linter.Config[];
}): Linter.Config[];
