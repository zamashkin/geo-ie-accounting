# WS-06 Ledger API + UI

**Phase 2.** Depends on WS-01, WS-02, WS-04, WS-05.

## Owns
`apps/api/src/routes/{accounts,transactions}/**`, `packages/db/src/repositories/{accounts,transactions}.ts`, `apps/web/app/o/[orgId]/{transactions,settings/accounts}/**`

## Deliver
- Accounts: list, create (bank accounts require currency), archive.
- Transactions: list with cursor pagination and filters (date range, account, currency, source, text search, taxable only), detail, create manual (the user picks an event type from the `domain` builders, not raw postings; an "advanced" mode allows raw postings), reverse.
- GEL conversion on create using `getRateFor`; a missing rate returns a problem+json `rate_unavailable` and enqueues a backfill.
- After create/reverse, enqueue `declaration.recompute` for the affected period.
- Web: transactions table (DataTable, URL-synced filters), detail sheet showing postings, rate used and audit trail, new-transaction form, reverse with confirmation.

## Acceptance
- Integration: create → list → reverse → balances and taxable turnover net to zero.
- Playwright: create an income receipt in USD and see the GEL equivalent with the rate date.
