# MVP: first usable slice

**Current focus (2026-10-16).** The full plan in `docs/tasks/` (WS-06 to WS-10 and the review follow-ups) is parked, not dropped. The MVP takes thin slices of WS-06, WS-07 and WS-08 so that Aleksandr can run the app locally and test it with his own Bank of Georgia statements.

## The demo path (acceptance)

1. Sign in with the seeded demo login or sign up, through the **real** auth API (no mock).
2. Create a workspace and set the small-business status start date.
3. Upload a BoG statement (XLSX or CSV). The bank account is matched or created from IBAN + currency.
4. Preview: every row shows date, amount, type and a suggested classification. The user can change the classification or skip a row, then commits.
5. Transactions page: imported transactions with the original amount, GEL equivalent, NBG rate and rate date. A transaction can be reversed.
6. Declarations page for a year: per month, line 15 (cumulative), lines 18–21 (by payment method), rate (1% / 3%), tax and deadline, plus YTD vs the GEL 500,000 limit.
7. Dashboard: YTD SBS income, tax for the latest month, next deadline, limit progress.
8. Re-uploading the same statement creates no duplicates.

With the fixture `fixtures/statements/bog/bog-gbp-2025-06.xlsx` and SBS start ≤ 2025-06-04, June 2025 must show income GEL 5,698.66 (4,357.03 + 1,341.63, at NBG rates 3.6924 and 3.6858), line 20 = 5,698.66, rate 1%, tax GEL 56.99, deadline 2025-07-15. The two CCO conversions are not income.

## Simplifications (deliberate, revisit after MVP)

| Full plan | MVP |
|---|---|
| Upload to S3, parse in a worker job, SSE progress | API parses synchronously (statements are small), stores batch + parsed rows in Postgres, and never stores the file |
| Commit in a worker job, in chunks | API commits in one request. Rates are resolved with `resolveRate` before the DB transaction; missing rates are backfilled inline |
| Categorisation rules engine | Fixed suggestions: incoming payment → `Income: Services` (SBS, payment method `bank`); fx_conversion → FX Clearing; anything else → user must pick an account or skip |
| Stored declarations, filing, drift | Computed on request with `computeDeclarationYear` from posted transactions. No filing |
| Manual transactions, invoices, accountant mode, audit UI, exports | Out. Reversal is in |
| Cross-statement FX matching | Not needed: each leg balances in its own currency through FX Clearing (GBP statement posts the GBP leg; a USD statement would post the USD leg) |

Still required: ledger triggers, tenancy guards, audit rows, idempotency on mutations, money as bigint/strings, tax math only via `packages/domain`.

## Work split

Two agents, one after the other, so the frontend builds against real, merged endpoints.

### MVP-A: backend slice
Owns `apps/api/src/routes/{accounts,imports,transactions,declarations,dashboard}/**`, the matching `packages/db/src/repositories/*`, new contracts files, org settings route (`PATCH /v1/orgs/:orgId` for `sbsEffectiveFrom`), and a db migration if needed.
- Contracts with OpenAPI ids for every new response.
- `POST /v1/orgs/:orgId/imports` (multipart, max 5 MB; detect + parse with `@ie-ledger/importers`; match/create the bank account by IBAN + currency; dedupe against `transaction_fingerprints`, and within the batch; store `import_batches` + `import_rows`), `GET` batch + rows, `PATCH` row (chosen account / skip), `POST .../commit`.
- Transactions: list (cursor pagination, filters: date range, account, source), detail with postings and rate, reverse.
- `GET /v1/orgs/:orgId/declarations?year=` and `GET /v1/orgs/:orgId/dashboard?year=`, both computed with `packages/domain`.
- Use the WS-02 rates code (`resolveRate`, `getRateFor`). Move `resolveRate` into a package both api and worker can use if needed.
- Integration tests: import the BoG fixture end to end, commit, assert the June 2025 figures above; a re-import gives 0 new rows; cross-tenant harness covers every new route automatically; reversal takes the income back out.
- Seed: also store the NBG rates the fixture needs (from `fixtures/nbg/`) so the demo works offline.

### MVP-B: frontend slice
Starts after MVP-A is merged. Owns `apps/web/**` pages for the demo path.
- Switch web to real auth (`NEXT_PUBLIC_AUTH_MODE=api` by default in `.env.example`); sign-in, sign-up, sign-out, org switcher from `/v1/me`.
- First-run flow: no workspace → create one → set SBS start date.
- Pages: dashboard, imports (upload with FileDropzone → preview table → commit), transactions (DataTable, filters in URL, detail sheet, reverse), declarations (year picker, monthly table laid out like the return lines).
- Playwright e2e of the whole demo path against the running stack with the BoG fixture, asserting the June 2025 figures. Screenshots at 1280px and 360px into `docs/screenshots/`.

## How Aleksandr tests it

```sh
cd ~/Documents/ie-ledger
docker compose up -d --wait && pnpm db:migrate && pnpm db:seed && pnpm dev
# open http://localhost:3000, sign in as demo@ie-ledger.local / demo-password-2026
# upload fixtures/statements/bog/bog-gbp-2025-06.xlsx, or a real statement from fixtures/statements/raw/
```

Real statements stay on this machine: the MVP stores parsed rows in the local Postgres only.
