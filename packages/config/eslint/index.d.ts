import type { Linter } from 'eslint';
import type { PackageName } from './boundaries.js';

export {
  boundaries,
  WORKSPACE_DEPS,
  FORBIDDEN_MODULES,
  forbiddenWorkspaceDeps,
  type PackageName,
} from './boundaries.js';

export declare function geoIeAccounting(options: {
  pkg: PackageName;
  root: string;
  typeChecked?: boolean;
  extra?: Linter.Config[];
}): Linter.Config[];
