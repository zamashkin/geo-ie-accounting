# 0016 Public demo: generated workspaces and a read-only login

Status: accepted (priority 1, 2026-10-17)

## Context
The project needs a demo a stranger can open: a year or more of believable bookkeeping, and a login that shows everything without letting anyone change it. The data must be fictional, deterministic and booked the way real data is, so the triggers, audit log and figures are the same as for a user. Production should be able to host it.

## Decision
- `pnpm db:seed:demo` (`apps/api/scripts/seed-demo.ts`, code in `apps/api/src/demo/`) builds the app in process and calls its routes as the workspace owner: create the workspace, accounts, rules and clients; issue invoices; upload synthetic Bank of Georgia CSV statements, fix rows, commit; match payments; file returns; reverse a mistake. It lives in `apps/api` rather than `packages/db` because the booking logic (import commit, filing, invoice numbering and matching) is in the routes, and re-implementing it in a seed would let the two drift apart. The API clock (`LedgerDeps.now`) moves through the months, so filings and invoices get plausible dates.
- The generator is deterministic: it seeds a PRNG per workspace, month and purpose, and the output depends on the profiles in `profile.ts`, the recorded rates and "today" (`DEMO_TODAY`, default: today in Tbilisi). Statuses are relative to today (one month overdue, or due while the 15th is ahead), so the data follows the calendar.
- `fixtures/nbg/demo-rates.json` holds every EUR, GBP and USD rate NBG published from 1 January 2025, recorded once by `pnpm --filter @geo-ie-accounting/nbg record-demo-rates`. Rows keep `source = 'nbg'` because they are NBG's. Dates after the recording come from NBG at seed time; tests use the fixture only.
- `organizations.demo_seed` stores `<profile>:v<generator version>:<today>`. A re-run with the same marker does nothing. With a different one, the old demo workspaces are retired (all memberships removed, renamed) and new ones built. Deleting them is impossible: postings, transactions and filings are insert-only by design.
- `users.read_only` marks the demo login (`demo@geo-ie-accounting.local`). The auth guards refuse every POST/PUT/PATCH/DELETE by such a user with 403 `demo_read_only`, whatever its role. The Better Auth passthrough allows only sign-in and sign-out for it, signed in or not, so password reset, magic links, email or profile changes are refused too. The flag is enforced whatever the configuration.
- `DEMO_MODE=true` lets read-only logins sign in and publishes the login on `GET /v1/public-config`, which the sign-in page shows as "Try the demo". Off, read-only logins cannot sign in. `DEMO_SIGNUP=false` turns off sign-up by password and by magic link.
- The owner login made by `pnpm db:seed` is now `dev@geo-ie-accounting.local` / `dev-password-2026`, so `demo@` is free for the public demo.

## Alternatives
- Seed with repository calls in `packages/db`: no HTTP overhead, but the import, filing and invoice flows would be written twice.
- Synthetic rates: simpler offline, but a real series is public, small (1,335 rows) and makes the GEL figures checkable.
- An org-level read-only flag: would need a bypass for the seed itself, and a viewer role alone still allows creating workspaces and changing one's own account.
- Purging demo workspaces with triggers disabled: needs a superuser and weakens the insert-only guarantee.

## Consequences
Every re-seed for a new day leaves the retired workspaces' rows behind (about 900 transactions each run). A hosted demo should re-seed on a schedule no more often than it needs to, and a privileged maintenance purge for retired demo orgs is a follow-up. Changes to the routes can break the generator: `src/demo/seed.int.test.ts` builds the whole demo on every integration run.
