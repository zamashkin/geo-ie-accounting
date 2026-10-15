# WS-08 Declarations + dashboard

**Phase 3.** Depends on Phase 2.

## Owns
`apps/worker/src/jobs/declarations/**`, `apps/api/src/routes/{declarations,dashboard}/**`, `packages/db/src/repositories/{declarations,reports}.ts`, `apps/web/app/o/[orgId]/{page.tsx,declarations}/**`

## Deliver
- `declaration.recompute` job: upsert draft declarations for affected periods using `domain/tax`; for filed periods, compute a diff and store a `drift` flag. Never modify a filed snapshot.
- API: list by year, period detail (laid out like the rs.ge return lines in SPEC §2.4: line 15 and lines 18–21, rate, tax, contributing transactions, deadline, rules version), file (owner/accountant; stores snapshot, audit entry). Zero months appear as "file zero return".
- Dashboard endpoint with aggregated SQL (no N+1): monthly turnover, by counterparty, currency mix, YTD vs cap, next deadline.
- Web: dashboard with streamed widgets (Suspense per widget), declarations list with status and drift badges, period page with "copy figures" for rs.ge and a printable view.
- Pick the chart library, write an ADR, lazy load it.

## Acceptance
- Golden test: fixture year of transactions → expected declaration JSON per month, including one year that crosses GEL 500,000 mid-month.
- Reversal in a filed month shows drift without changing the filed snapshot.
- Dashboard LCP and JS budget within ARCHITECTURE targets.
