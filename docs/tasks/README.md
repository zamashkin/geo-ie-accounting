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
| 02 | NBG rates | in progress | ws/02-nbg-rates |
| 03 | Statement parsers | in progress (BoG; TBC waits for fixtures) | ws/03-importers |
| 04 | Web shell + UI kit | in progress | ws/04-web-shell |
| 05 | Auth + tenancy | in progress | ws/05-auth-tenancy |
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
