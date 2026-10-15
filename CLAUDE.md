# IE Ledger: agent instructions

Bookkeeping + 1% small-business tax tool for Georgian individual entrepreneurs. Portfolio project: code quality is part of the product.

Read before any work: `docs/SPEC.md`, `docs/ARCHITECTURE.md`, your brief in `docs/tasks/`, relevant `docs/adr/`.

## Hard rules
- Money is `bigint` minor units in code, `bigint` in DB, decimal **string** in JSON. Never `number`, never floats, never `parseFloat` on money.
- All FX and tax math goes through `packages/domain`. No ad-hoc conversion anywhere else.
- Tax rules are dated config in `packages/domain/src/tax/rules.ts`. Never hardcode 1%, 500,000 or the 15th anywhere else.
- Postings are insert-only. Corrections are reversing transactions.
- Every tenant query is scoped by `orgId`. Every new `/v1/orgs/:orgId/*` route is covered by the cross-tenant test harness.
- Every mutation: one DB transaction, audit log row, `Idempotency-Key` support.
- Contracts (`packages/contracts`) are the source of truth for request/response/job/event shapes. Do not redefine shapes locally.
- Respect package dependency rules in ARCHITECTURE §2. `web` never imports `db`.
- Never log statement contents, IBANs or amounts at info level. Never commit real statements (`fixtures/statements/raw/` is gitignored).
- No live network in tests. Record fixtures.

## Working style
- Check current docs for the pinned library versions; do not rely on memory for APIs of Next.js, Fastify, Drizzle, pg-boss, Better Auth.
- Write tests with the code, not after.
- If a decision isn't covered by the docs, choose, then record it: a short ADR for anything structural, otherwise a line in your report.
- Stay inside the paths your brief owns. Report needed changes elsewhere instead of making them.

## Commands (available after WS-00)
```
pnpm dev | pnpm turbo typecheck lint test | pnpm db:migrate | pnpm db:seed | pnpm gen:api
```
