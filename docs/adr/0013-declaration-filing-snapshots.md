# 0013 Declarations: live figures, filed snapshots

Status: accepted (WS-08, 2026-10-17)

## Context
WS-08 planned a `declaration.recompute` job that upserts a draft row per month into `declarations` and sets a `has_drift` flag on filed months. The MVP computes the figures from the postings on every request instead (docs/MVP.md). That costs a few aggregate queries per year, and the figures are never out of date.

## Decision
- Live figures are never stored. `computeDeclarationYear` runs on every read, on SBS income that SQL has already grouped by date and payment method.
- Filing a month inserts one row into `declaration_filings`. The row holds the figures (line 15, lines 18 to 21, rate, tax), the rules version, the ids of the contributing transactions, the optional rs.ge reference, who filed it and when, plus the wire-encoded month in `snapshot`.
- The table is insert-only: a trigger rejects UPDATE, DELETE and TRUNCATE (`ledger_immutable`, as on postings). Refiling inserts a correction with `version + 1` and `supersedes_id` pointing at the filing it replaces. Unique indexes on (org, period, version) and on `supersedes_id` keep the corrections a chain. The request has to name the latest filing in `supersedesId`, and a per-period advisory lock serialises concurrent filings.
- Status (`not_due`, `due`, `overdue`, `filed`, `filed_with_drift`) and drift come from `packages/domain/src/tax/filing.ts`, which compares the latest filing with the live figures line by line. The API returns each line that moved and the transaction ids added or removed since filing.
- A month can be filed once it has ended and only if the status covers it. Zero months file like any other, as zero returns.
- The unused `declarations` table and its `declaration_status` enum are dropped (migration `0004_declarations`).

## Alternatives
- Recompute job with stored drafts and a drift flag: the flag needs a job after every commit, reversal and rate backfill, and one missed trigger leaves a wrong badge.
- One row per period, updated on refile: loses the filing history that SPEC §3 M3 asks us to keep ("never silently change filed snapshots").

## Consequences
Each declarations or dashboard request runs a few aggregate queries. That stays cheap until an org has years of daily postings, and a cache or a materialised view could come later without a contract change. A correction never touches the earlier filing, so the table itself is the filing history; each filing also writes an `audit_log` row.
