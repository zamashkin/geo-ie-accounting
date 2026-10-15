# WS-02 NBG rates

**Phase 1.**

## Owns
`packages/nbg/**`, `apps/worker/src/jobs/rates/**`, `apps/api/src/routes/rates/**`, `apps/web/app/rates/**`, `fixtures/nbg/**`

## Consumes
`contracts` (rate DTOs, `rates.*` job payloads, `rates.backfilled` event), `db` (`exchange_rates`).

## Deliver
- `packages/nbg`: client for the NBG endpoint and semantics in SPEC §2.3 (checked 2026-10-15). Record real responses for a weekday, a weekend and a public holiday in `fixtures/nbg/`. Parse with Zod (`validFromDate`, `rate`, `quantity`, `date`); retries with backoff; timeout.
- Worker jobs `rates.sync` (cron) and `rates.backfill(from, to, currencies)` with idempotent upsert into `exchange_rates`; emit `rates.backfilled`.
- `domain`-facing lookup in `packages/db`: `getRateFor(currency, date)`: the row with the greatest `valid_from <= date` (SPEC §2.3), backfilling if there is a gap. **Coordinate: this file is in `packages/db`; propose the function signature in your report if WS-00 did not create it.**
- API: `GET /v1/rates`, `POST /v1/rates/backfill` (admin only; stub the admin check if WS-05 has not landed).
- Web: `/rates` page with currency picker and date range table (RSC).

## Acceptance
- Unit tests for parsing against recorded fixtures; no live network in tests.
- Integration test: backfill twice for the same range → no duplicates; a Sunday receipt resolves to Friday evening's rate.
