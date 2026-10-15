# WS-00 Foundation

**Phase 0. Runs alone. Everything else depends on it.**

## Owns
Entire repo (first agent), but keep app code to skeletons.

## Deliver
1. pnpm workspace + Turborepo with the layout in ARCHITECTURE §2. Every package builds, has `typecheck`, `lint`, `test` scripts (an empty passing test is fine).
2. `packages/config`: shared `tsconfig` (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), ESLint flat config, Prettier, Vitest preset.
3. Dependency rule from ARCHITECTURE §2 enforced by lint; a test import that breaks it must fail lint.
4. `docker-compose.yml`: postgres 17, minio (+ bucket init), mailpit. Healthchecks.
5. `apps/api`: Fastify boots on :4000, `/healthz`, Zod type provider, OpenAPI generation script writing `apps/api/openapi.json`, problem+json error handler, request ID, pino logging, env validated with Zod.
6. `apps/worker`: boots, connects pg-boss, registers a `noop` job, graceful shutdown.
7. `apps/web`: Next.js App Router boots on :3000, Tailwind configured, typed API client generated from `openapi.json` (`pnpm gen:api`), one page calling `/healthz`.
8. `packages/contracts` v0: `Money`/`CurrencyCode`/`ISODate` schemas (money as string → bigint), problem+json schema, pagination schema, job payload and SSE event unions (empty or placeholder members are fine), entity DTOs for every table in ARCHITECTURE §5.
9. `packages/db` v0: full Drizzle schema from ARCHITECTURE §5, first migration, the balance and immutability triggers (raw SQL migration), `db:migrate`, `db:seed` (one user, one org, seeded chart of accounts).
10. GitHub Actions workflow with the jobs in ARCHITECTURE §11 (e2e and perf may be placeholders).
11. Root `README.md` "Getting started" works on a clean machine; `.env.example` for each app.

## Acceptance
- `pnpm i && docker compose up -d && pnpm db:migrate && pnpm db:seed && pnpm dev` works; web shows API health.
- `pnpm turbo typecheck lint test` green.
- Integration test: inserting an unbalanced transaction fails; updating a posting fails.
- ADRs 0001–0005 updated with the versions actually pinned.
