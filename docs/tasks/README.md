# Work plan for parallel agents

> **MVP delivered (2026-10-16), see [`docs/MVP.md`](../MVP.md).** It built thin versions of WS-06, WS-07 and WS-08. WS-06 to WS-10 resume from what it built; check the MVP code before following a brief literally.

## Priorities (set by Aleksandr, 2026-10-17)

Done since the MVP: polish pass, declarations filing and dashboard widgets, accounts / manual transactions / rules, invoices, CI.

1. **Public demo:** done (2026-10-17, [ADR 0016](../adr/0016-public-demo.md)): `pnpm db:seed:demo` builds two generated workspaces and a read-only demo login; `DEMO_MODE` and `DEMO_SIGNUP` switch it on for a hosted server. Hosting it is part of deployment below.
2. **Account and member management:** done (2026-10-22): password reset (`/forgot-password`, `/reset-password`), an account page (name, email change, password change, signed-in sessions), `proxy.ts` returning signed-out visits to the page asked for, and a members page with role changes, removal, leaving and invitation resend/revoke. A row lock on the org's memberships keeps at least one owner under concurrency (409 `last_owner`).
3. **Smaller items:** keep bank-GEL warnings on the batch, multi-line address fields, client list paging, PDF page numbers, and an automatic rate backfill when a manual transaction's rate is missing.
4. **Exports:** ledger CSV and a declaration summary PDF.
5. **Behind the scenes (order not set yet):** reviewer README, real e2e/Storybook jobs in CI, deployment and hosting the public demo (needs SPEC Q4), Sentry/tracing, background import pipeline (S3, worker jobs, SSE), Postgres RLS, admin role for rate backfill.
6. **Blocked: TBC Bank statements.** Wanted, but there are no TBC exports to build from yet.
7. **Last:** accountant mode, then the audit log UI.

Each `WS-*.md` file is a self-contained brief for one subagent. A brief lists what the agent owns (directories it may write), what it consumes, what it must deliver, and how "done" is checked.

## Rules for every agent

1. Read `CLAUDE.md`, `docs/SPEC.md`, `docs/ARCHITECTURE.md` and your brief before writing code.
2. Write only inside the paths your brief owns. If you need a change elsewhere (most often `packages/contracts`), stop and report the exact change needed instead of making it.
3. Work in your own git worktree on branch `ws/<id>-<slug>`. Small commits. Do not merge to `main`; the coordinator does.
4. Done means: acceptance criteria met, `pnpm turbo typecheck lint test --filter=<your packages>` green, and a short report: what was built, decisions taken, anything stubbed, follow-ups.

## Phases and dependencies

```
Phase 0 (sequential, one agent)
  WS-00 Foundation: monorepo, tooling, compose, CI, contracts v0, db schema v0

Phase 1 (parallel, after WS-00 merged)
  WS-01 Domain core        packages/domain
  WS-02 NBG rates          packages/nbg, worker rates jobs, api /rates
  WS-03 Statement parsers  packages/importers            (BoG fixtures ready; TBC pending)
  WS-04 Web shell + UI kit apps/web shell, packages/ui
  WS-05 Auth + tenancy     apps/api auth, memberships, authz hooks, audit, idempotency

Phase 2 (parallel, after Phase 1 merged)
  WS-06 Ledger API + UI    accounts, transactions, reversal (api + web pages)
  WS-07 Import pipeline    worker import jobs, api imports routes, SSE, import wizard UI

Phase 3 (parallel)
  WS-08 Declarations + dashboard
  WS-09 Invoices

Phase 4
  WS-10 Accountant mode, RLS, audit UI, perf budget, deploy, demo seed
```

Phase 1 and later briefs are written against the contracts produced in WS-00. Contract changes after Phase 0 go through the coordinator so parallel agents never edit `packages/contracts` at the same time.

## Status

| WS | Title | Status | Branch |
|---|---|---|---|
| 00 | Foundation | merged | ws/00-foundation |
| 01 | Domain core | merged | ws/01-domain |
| 02 | NBG rates | merged | ws/02-nbg-rates |
| 03 | Statement parsers | merged for BoG + generic CSV; TBC waits for fixtures | ws/03-importers |
| 04 | Web shell + UI kit | merged | ws/04-web-shell |
| 05 | Auth + tenancy | merged | ws/05-auth-tenancy |
| 06 | Ledger API + UI | todo | |
| 07 | Import pipeline | todo | |
| 08 | Declarations + dashboard | done on the MVP model (ADR 0013): filing, drift, period page, dashboard aggregates | |
| 09 | Invoices | todo | |
| 10 | Hardening + deploy | todo | |

## Inputs needed from Aleksandr (later)

These don't block Phase 0 or the BoG parsers. Add files to `fixtures/statements/raw/` and anonymise them as described in `fixtures/statements/README.md`.

- [ ] TBC Bank statement exports (CSV and XLSX). Blocks the `tbc-*` parsers in WS-03.
- [ ] Bank of Georgia statement from a USD or GEL account, to confirm the format is the same across currencies.
- [ ] A statement with outgoing payments (so far only incoming transfers and conversions have been seen). Needed for unknown `Operation Type` codes and the recipient columns.
- [ ] Decide whether fixtures keep real amounts or get synthetic ones (matters if the repo goes public).
- [ ] Accountant check of the *secondary* tax rules (SPEC Q3) before the M3 release.

## Follow-ups found in review

- MVP: the bank GEL warnings (`bank_gel_mismatch`) come back only in the commit response, so they're gone once the import page reloads. If they should stay visible, store them on the batch.
- MVP: on phones the import preview renders every row as a card with no virtualisation. That's fine for BoG statements (tens of lines). A statement with thousands of lines would need paging.
- Web lint after `next dev`: the route types `next dev` writes to `.next/types` make `no-unnecessary-type-assertion` flag the 9 `as Route` casts. With the types from `next typegen`, which turbo runs before lint (and CI uses), the casts are needed and lint is clean. After a dev session, run `pnpm --filter @geo-ie-accounting/web typegen` before linting, or find a cast-free way to build the hrefs.

- WS-01: the Order N38 rule set starts 2026-03-01, but the order came into force around 2026-03-07/08 (30 days after publication on 06.02.2026). Confirm the exact date with the accountant (Q3) and adjust `effectiveFrom`. It only matters for SBS applications filed 1–7 March 2026.
- WS-01: deadlines don't move when the 15th falls on a weekend or public holiday. Ask the accountant whether they should.
- WS-08: add a test in db or api that the domain and contracts enum lists match.
- WS-03: unverified BoG cases (overdrawn balances in the CSV, outgoing payments, GEL/USD accounts, the credit side of conversions) need the extra statements listed under "Inputs needed".
- WS-07: the dedupe hash differs between BoG CSV (no operation ID) and XLSX for the same operation. Match across formats on date + amount + document number. Match bank accounts on IBAN + currency, because BoG uses one IBAN for all of a client's currency accounts.
- WS-02: `POST /v1/rates/backfill` uses a stub `x-admin-token` guard (`STUB(WS-05)`). Replace it with a real admin role. Rates are global, so this route has no audit row or `Idempotency-Key`, because both tables require an `org_id`. Decide how global admin actions are audited.
- WS-02: SPEC §2.3 asks to store the requested date as well as `valid_from`; v0 stores only `valid_from`. Proposed: an `exchange_rate_lookups(currency, requested_date, valid_from)` table, so gaps are found in the database rather than with an NBG call.
- WS-02: worker `JobContext` has no db handle; the rates jobs open their own pool, which is never closed on shutdown. Add `db` to `JobContext` (WS-07 needs it too).
- WS-02: WS-07 must call `resolveRate` before each chunk's DB transaction (it may call NBG) and store the row id as `postings.rate_id`.
- CI: `@geo-ie-accounting/worker#test` failed once under a full parallel turbo run, then passed alone and on re-run. Watch for flakiness.
- WS-05: add `users.is_admin` + `requireAdmin()` and replace WS-02's `x-admin-token` stub on `POST /v1/rates/backfill` (now `config: { tx: false }`, so it skips the request transaction and idempotency). Decide how global admin actions get audited (audit_log.org_id is NOT NULL).
- WS-05: worker job to call `deleteExpiredIdempotencyKeys`; move Better Auth's in-memory rate limiter to the DB before running more than one API instance; consider default-deny guards on every `/v1` route.
- Accounts: Better Auth's limits are now keyed on `req.ip` (`x-geo-ie-client-ip`). Behind a reverse proxy that is the proxy's address, so set Fastify `trustProxy` when deploying, or every user shares one bucket again.
- Accounts: name, email and password changes and session revokes have no audit row, because `audit_log.org_id` is NOT NULL. Same open question as global admin actions.
- Accounts: e2e coverage for reset, the account page and members (kept out on purpose for now; an ad-hoc browser run passed).
- WS-04: CI needs a Storybook job (`pnpm exec playwright install --with-deps chromium`, then `pnpm --filter @geo-ie-accounting/ui build-storybook` and `test:storybook`). The unit `test` script stays Node-only.
- WS-04: run the invite-and-accept flow end to end (sign-in and org switching already have e2e specs).
- Bundle: `/sign-in` ships 269 KB gzip (zod + full contracts + react-hook-form). Contracts subpath exports would save about 37 KB.
