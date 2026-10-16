# 0012 MVP: the API imports statements synchronously

Status: accepted (MVP-A, 2026-10-16)

## Context
ARCHITECTURE §6 sends an upload to S3 and parses and commits it in worker jobs, with SSE progress. The MVP (docs/MVP.md) needs a working import first. Statements are small: a month of BoG lines is a few kilobytes, and parsing takes milliseconds.

## Decision
- `POST /v1/orgs/:orgId/imports` takes the file as multipart (one file, at most 5 MB), detects the format and parses it in the API process with `@ie-ledger/importers`. It stores the batch and the parsed rows in Postgres and never stores the file: `import_batches.file_key` is null.
- `POST /v1/orgs/:orgId/imports/:id/commit` books every remaining row in one request transaction.
- Rates: a `preHandler` resolves every (currency, booked date) the batch needs with `resolveRate` before the request transaction opens, because `resolveRate` may call NBG. The handler inside the transaction only reads the resolved rows. `resolveRate` moved from the worker into `packages/db` with the rate source injected (`RateSource`, which `NbgClient` satisfies), so the API and the worker share one implementation without db importing nbg.
- `api -> importers` is added to the dependency rules (`packages/config/eslint/boundaries.js`, ARCHITECTURE §2). Importers stay pure, so this adds no I/O to the API.
- Dedupe: every committed line stores its primary `dedupeHash` and, when it has a document number, a second hash on account + date + amount + document number (`documentDedupeHash`). BoG's CSV export has no operation id, so its primary hash differs from the XLSX one; the second hash makes a CSV re-import of an XLSX statement (or the reverse) find the lines it already has.
- A statement is matched to a bank account on IBAN and currency, because BoG uses one IBAN for all of a client's currency accounts. Without a match, an unused default bank account of that currency (no IBAN, no postings) is claimed; otherwise a new one is created.

## Alternatives
- **Worker jobs now**: the full plan. More moving parts (S3, pg-boss jobs, SSE) before anyone can try the app.
- **Parse in the browser**: would put the parsers in the web bundle and trust client-side parsing for tax figures.

## Consequences
A large statement holds an API request for its parse and commit; the 5 MB cap bounds that. Moving to the worker later changes where the code runs, not the contracts: the batch and row shapes stay. Without the file, a batch cannot be re-parsed after a parser fix; the user uploads it again, and dedupe makes that safe.
