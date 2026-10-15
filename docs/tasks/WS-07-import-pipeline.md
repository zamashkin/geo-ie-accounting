# WS-07 Import pipeline

**Phase 2.** Depends on WS-01, WS-02, WS-03, WS-04, WS-05.

## Owns
`apps/worker/src/jobs/import/**`, `apps/api/src/routes/{imports,rules,events}/**`, `packages/db/src/repositories/{imports,rules,fingerprints}.ts`, `apps/web/app/o/[orgId]/{imports,settings/rules}/**`

## Deliver
- Full flow in ARCHITECTURE §6: upload to S3 (encrypted, checksum stored), parse job, preview, row edits, commit job in chunks, fingerprints.
- Same-file re-upload (same sha256 for same account) is detected at upload and links to the existing batch.
- Categorisation rules CRUD + "create rule from this row" in preview; re-apply rules to an open preview.
- SSE endpoint with `LISTEN/NOTIFY` fan-out, heartbeat, reconnect with `Last-Event-ID`.
- Wizard UI: pick account → upload (dropzone) → detected format and confidence (manual override; generic CSV mapping step) → live parse progress → preview table (status filter, bulk set account, skip) → commit with progress → summary.
- Failure UX: parse errors shown per row; failed job can be retried from the UI.

## Acceptance
- Integration: importing the same fixture twice creates transactions once.
- Worker crash mid-commit (simulated) then retry → no partial duplicates.
- Playwright: full wizard on the TBC fixture, keyboard only.
