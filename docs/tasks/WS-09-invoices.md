# WS-09 Invoices

**Phase 3.** Depends on Phase 2.

## Owns
`apps/api/src/routes/{clients,invoices}/**`, `apps/worker/src/jobs/invoices/**`, `packages/db/src/repositories/{clients,invoices}.ts`, `apps/web/app/o/[orgId]/{clients,invoices}/**`

## Deliver
- Clients CRUD. Invoices: draft → issued (number assigned atomically, gapless per org) → paid / void.
- PDF rendering job with `@react-pdf/renderer`; stored in S3; signed download URL; `invoice.pdf_ready` event.
- Payment matching: suggestions for incoming unmatched import transactions (amount + currency exact, counterparty fuzzy, date ≥ issue date); confirm match → `invoice_payments` row, status `paid` when fully covered.
- Web: invoice editor with live totals (MoneyInput), list with status filters, client page with history, match-payment dialog.

## Acceptance
- Concurrency test: 20 parallel "issue" calls yield 20 distinct consecutive numbers.
- Playwright: create client → invoice → issue → download PDF → match an imported payment → status paid.
