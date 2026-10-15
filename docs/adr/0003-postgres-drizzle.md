# 0003 PostgreSQL + Drizzle, integrity in the database

Status: accepted

## Decision
PostgreSQL with Drizzle ORM and SQL migrations. Ledger invariants (balanced transactions, insert-only postings) are enforced with triggers, not only in application code. Money is `bigint` minor units; rates are `numeric`.

## Alternatives
- Prisma: weaker support for raw SQL triggers and bigint ergonomics.
- App-level checks only: one bug away from an unbalanced ledger.

## Consequences
Some logic exists in SQL and must be covered by integration tests against real Postgres (Testcontainers).
