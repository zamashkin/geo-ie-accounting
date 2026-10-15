# 0001 Monorepo with pnpm + Turborepo

Status: accepted (versions pinned in WS-00)

## Context
Web, API, worker and several pure packages share contracts and domain logic. Changes often span them.

## Decision
One repo, pnpm workspaces, Turborepo for task graph and caching.

## Alternatives
- Separate repos: contract drift, harder for one person to keep coherent.
- Nx: more features than needed; Turborepo is lighter.

## Consequences
Dependency boundaries must be enforced by lint, not by repo walls.
