# 0001 Monorepo with pnpm + Turborepo

Status: accepted (versions pinned in WS-00, 2026-10-15)

## Context
Web, API, worker and several pure packages share contracts and domain logic. Changes often span them.

## Decision
One repo, pnpm workspaces, Turborepo for task graph and caching.

Workspace packages are internal: their `exports` point at TypeScript source and they have no build step of their own. The apps compile them (Next.js `transpilePackages`; esbuild bundles for the API and worker via `packages/config/bin/build-node-app.mjs`). Each package has `typecheck`, `lint` and `test` scripts; apps also have `build`.

Dependency rules from ARCHITECTURE §2 are enforced by `packages/config/eslint/boundaries.js` (`no-restricted-imports` plus a rule that stops relative imports leaving a package). Its tests lint offending imports and check every `package.json` against the same table. Two packages missing from §2 got these rules: `nbg -> contracts, domain` and `ui -> domain` (for money formatting).

## Pinned versions

| Tool | Version | Note |
|---|---|---|
| Node.js | 24 (`.nvmrc`, `engines >=24`) | |
| pnpm | 11.21.0 (`packageManager`) | build scripts allow-listed in `pnpm-workspace.yaml` (`allowBuilds`); new releases go through pnpm's minimum release age |
| Turborepo | 2.11.8 | strict env mode: integration-test variables are declared in `turbo.json` |
| TypeScript | 6.0.3 | 7.0 (the native port) is out, but typescript-eslint 8.71 supports `<6.1`. Move when it does. |
| ESLint | 10.12.0, typescript-eslint 8.71.2 | |
| Prettier | 3.9.10 | |
| Vitest | 5.0.5 | |

## Alternatives
- Separate repos: contract drift, harder for one person to keep coherent.
- Nx: more features than needed; Turborepo is lighter.
- Building each library to `dist/`: extra watch processes and stale-build bugs for no gain while nothing is published.

## Consequences
Dependency boundaries must be enforced by lint, not by repo walls. Production images for the API and worker need their npm dependencies installed next to the bundle (`pnpm deploy`, WS-10).
