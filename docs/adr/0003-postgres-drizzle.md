# 0003 PostgreSQL + Drizzle, integrity in the database

Status: accepted (versions pinned in WS-00, 2026-10-15)

## Decision
PostgreSQL with Drizzle ORM and SQL migrations. Ledger invariants (balanced transactions, insert-only postings) are enforced with triggers, not only in application code. Money is `bigint` minor units; rates are `numeric`.

## Pinned versions

| Package | Version |
|---|---|
| PostgreSQL | 17.11 (`postgres:17.11-alpine` in compose, CI and Testcontainers) |
| drizzle-orm | 0.45.4 |
| drizzle-kit | 0.31.11 |
| pg (node-postgres) | 8.23.1 |
| testcontainers, @testcontainers/postgresql | 12.2.1 |

## How it is enforced (migration `0001_ledger_triggers.sql`)
- `postings`: UPDATE, DELETE and TRUNCATE raise `23001 restrict_violation` with constraint `ledger_immutable`.
- `transactions`: only `description` and `notes` may change; DELETE and TRUNCATE raise the same error.
- Deferred constraint triggers check each inserted transaction at COMMIT: at least two postings (`transaction_min_postings`), zero sum per currency (`transaction_balanced`), and a `payment_method` when it posts to an SBS income account (`transaction_payment_method_required`). All raise `23514 check_violation`.
- Composite foreign keys `(account_id, org_id)` and `(transaction_id, org_id)` stop a posting from crossing organisations.
- A transaction can be reversed once (partial unique index on `reverses_id`).

IDs are UUID v7 generated in the app (`uuidv7`), because Postgres 17 has no built-in v7 function.

## Alternatives
- Prisma: weaker support for raw SQL triggers and bigint ergonomics.
- App-level checks only: one bug away from an unbalanced ledger.

## Consequences
Some logic exists in SQL and must be covered by integration tests against real Postgres (Testcontainers locally, a service container in CI). Deleting an organisation that has ledger entries fails by design.
