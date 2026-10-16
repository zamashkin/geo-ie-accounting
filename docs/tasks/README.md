# Work plan for parallel agents

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
| 08 | Declarations + dashboard | todo | |
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

- WS-01: the Order N38 rule set starts 2026-03-01, but the order came into force around 2026-03-07/08 (30 days after publication on 06.02.2026). Confirm the exact date with the accountant (Q3) and adjust `effectiveFrom`. It only matters for SBS applications filed 1–7 March 2026.
- WS-01: deadlines don't move when the 15th falls on a weekend or public holiday. Ask the accountant whether they should.
- WS-08: add a test in db or api that the domain and contracts enum lists match.
- WS-03: `packages/importers/src/lib/{decimal,currency}.ts` duplicate helpers that now exist in `packages/domain` (merged in parallel). Switch importers to the domain helpers and delete the copies.
- WS-03: unverified BoG cases (overdrawn balances in the CSV, outgoing payments, GEL/USD accounts, the credit side of conversions) need the extra statements listed under "Inputs needed".
- WS-07: the dedupe hash differs between BoG CSV (no operation ID) and XLSX for the same operation. Match across formats on date + amount + document number. Match bank accounts on IBAN + currency, because BoG uses one IBAN for all of a client's currency accounts.
- WS-02: `POST /v1/rates/backfill` uses a stub `x-admin-token` guard (`STUB(WS-05)`). Replace it with a real admin role. Rates are global, so this route has no audit row or `Idempotency-Key`, because both tables require an `org_id`. Decide how global admin actions are audited.
- WS-02: SPEC §2.3 asks to store the requested date as well as `valid_from`; v0 stores only `valid_from`. Proposed: an `exchange_rate_lookups(currency, requested_date, valid_from)` table, so gaps are found in the database rather than with an NBG call.
- WS-02: worker `JobContext` has no db handle; the rates jobs open their own pool, which is never closed on shutdown. Add `db` to `JobContext` (WS-07 needs it too).
- WS-02: WS-07 must call `resolveRate` before each chunk's DB transaction (it may call NBG) and store the row id as `postings.rate_id`.
- CI: `@ie-ledger/worker#test` failed once under a full parallel turbo run, then passed alone and on re-run. Watch for flakiness.
- WS-05: add `users.is_admin` + `requireAdmin()` and replace WS-02's `x-admin-token` stub on `POST /v1/rates/backfill` (now `config: { tx: false }`, so it skips the request transaction and idempotency). Decide how global admin actions get audited (audit_log.org_id is NOT NULL).
- WS-05: worker job to call `deleteExpiredIdempotencyKeys`; move Better Auth's in-memory rate limiter to the DB before running more than one API instance; member role change/removal with a last-owner guard; consider default-deny guards on every `/v1` route.
- WS-04: CI needs a Storybook job (`pnpm exec playwright install --with-deps chromium`, then `pnpm --filter @ie-ledger/ui build-storybook` and `test:storybook`). The unit `test` script stays Node-only.
- WS-04: switch the web to real auth (`NEXT_PUBLIC_AUTH_MODE=api`, `NEXT_PUBLIC_API_URL`) and run the sign-in, invite and org-switch flow end to end against WS-05. Add password reset pages. After sign-in, return users to the page they asked for (needs `proxy.ts`).
- WS-04/WS-01: swap `packages/ui/src/money/format.ts` and `packages/importers/src/lib/{decimal,currency}.ts` for the domain helpers.
- Bundle: `/sign-in` ships 269 KB gzip (zod + full contracts + react-hook-form). Contracts subpath exports would save about 37 KB.
