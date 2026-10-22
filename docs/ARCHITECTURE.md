# geo-ie-accounting: architecture

Read `SPEC.md` first. Decisions with alternatives considered live in `docs/adr/`.

## 1. Stack

| Concern | Choice | ADR |
|---|---|---|
| Monorepo | pnpm workspaces + Turborepo | 0001 |
| Web | Next.js (latest stable, App Router, RSC), TypeScript strict, Tailwind CSS | 0002 |
| API | Fastify + `fastify-type-provider-zod` + `@fastify/swagger` (OpenAPI 3.1 generated from Zod) | 0002 |
| API client in web | `openapi-typescript` + `openapi-fetch`, generated from the API's spec | 0002 |
| Server state in web | TanStack Query for client components; direct typed fetch in RSC | — |
| DB | PostgreSQL 17, Drizzle ORM + drizzle-kit migrations | 0003 |
| Jobs | pg-boss (Postgres-backed queue, no Redis) | 0004 |
| Realtime | Server-Sent Events from API; worker → API via Postgres `LISTEN/NOTIFY` | 0005 |
| Auth | Better Auth in the API (email+password, magic link), httpOnly session cookie | — |
| Object storage | S3-compatible (RustFS locally), server-side encryption | 0006 |
| Validation / contracts | Zod schemas in `packages/contracts`, shared by api, web, worker | — |
| PDF | `@react-pdf/renderer` in the API, rendered on request | 0015 |
| Public demo | Generated through the API in process, read-only login | 0016 |
| Testing | Vitest (unit + integration with Testcontainers Postgres), Playwright (e2e), Storybook (UI) | — |
| Observability | OpenTelemetry (traces), pino (logs), Sentry (errors, web + api + worker) | — |
| CI | GitHub Actions | — |
| Local env | Docker Compose: postgres, s3 (RustFS), mailpit | 0006 |

Pin exact versions in M0 and record them in the root `package.json`. Agents must check current docs for the pinned versions rather than relying on memory.

## 2. Repository layout

```
geo-ie-accounting/
  apps/
    web/            Next.js app. UI only. No DB access. Talks to api over HTTP.
    api/            Fastify. Auth, HTTP routes, authorization, enqueues jobs, SSE.
    worker/         pg-boss consumers: rates, imports, pdf, declarations.
  packages/
    contracts/      Zod schemas for every request/response/job payload/event. Source of truth.
    domain/         Pure TS business logic: money, FX conversion, ledger rules, tax rules,
                    dedupe hashing. No I/O. 100% unit tested.
    db/             Drizzle schema, migrations, seed, typed repositories, tenancy helpers.
    importers/      Pure statement parsers: (file bytes, options) -> ParsedRow[]. No I/O.
    nbg/            NBG rates HTTP client + response parsing.
    ui/             Design-system components (Storybook). No app logic.
    config/         Shared tsconfig, eslint, vitest presets.
  docs/
  fixtures/         Sample statements and NBG responses for tests.
  docker-compose.yml
```

**Dependency rule** (enforced by `packages/config/eslint/boundaries.js`, see ADR 0001):

```
web      -> contracts, ui, domain (formatting only)
api      -> contracts, domain, db, importers, nbg   (importers: MVP synchronous import, ADR 0012)
worker   -> contracts, domain, db, importers, nbg
db       -> domain, contracts
importers-> contracts, domain
nbg      -> contracts, domain
ui       -> domain (formatting only)
domain   -> (nothing)
contracts-> (nothing but zod)
```

`web` never imports `db`. `domain` and `importers` never do I/O.

## 3. Money and FX (`packages/domain`)

- `Money = { amountMinor: bigint; currency: CurrencyCode }`. Minor units per ISO 4217 table in `domain/currency.ts` (GEL, USD, EUR, GBP = 2).
- Never use `number` for money. Serialise as **string** in JSON (`"125000"`), parse to `bigint` at the edges via Zod.
- Rates: NBG publishes `rate` per `quantity` units (e.g. 1 USD = 2.7123 GEL, or 100 units of some currencies). Store `rate` as `numeric(18,6)` in DB and as a scaled bigint in code: `rateScaled = rate * 10^6`.
- Conversion: `gelMinor = roundHalfEven(amountMinor * rateScaled / (quantity * 10^6))`. Rounding mode is a single function with tests; declare it in an ADR once Q6 is answered.
- Each posting stores: `amountMinor`, `currency`, `gelAmountMinor`, `rateId`. GEL postings use rate 1 with `rateId = null`.

## 4. Ledger model

Double-entry. A **transaction** (journal entry) has ≥ 2 **postings**. For each transaction, postings sum to zero **per currency**. Currency conversions between own accounts go through the system `FX Clearing` account so each currency balances independently.

Examples:

| Event | Postings |
|---|---|
| Client pays 1,000 USD | `Bank USD +1000.00 USD`, `Income:Services −1000.00 USD` (taxable) |
| Bank converts 500 USD → 1,350 GEL | `Bank USD −500 USD`, `FX Clearing +500 USD`, `FX Clearing −1350 GEL`, `Bank GEL +1350 GEL` |
| Pay 1% tax | `Tax Payable +x GEL`, `Bank GEL −x GEL` |
| Correction | New transaction with every posting negated, `reversesId` set |

Sign convention: positive = debit, negative = credit.

**SBS income for a period** = `−Σ gelAmountMinor` of postings on accounts with `income_class = 'sbs'`, where transaction `occurredOn` falls in the period and on or after `sbs_effective_from`. Reversals reduce it automatically.

**Rate for a month** (SPEC §2.1): 1%, unless cumulative SBS income from 1 January up to the end of that month is above GEL 500,000, in which case 3%. Once a month is at 3%, every later month that year is too. Tax = rate × that month's SBS income. Implemented once in `domain/tax/declaration.ts`.

Posted transactions are **immutable**. The DB rejects UPDATE/DELETE on `postings` (trigger) and on `transactions` except for non-financial fields (`description`, `notes`).

## 5. Data model (`packages/db`)

All tables have `id uuid` (v7), `created_at`, and tenant tables have `org_id` with FK and index. Names are snake_case.

The schema in `packages/db/src/schema` is the source of truth. Beyond the sketch below it has: Better Auth's tables (`auth_sessions`, `auth_accounts`, `auth_verifications`, plus `email_verified`, `image`, `updated_at` on `users`); `org_id` on every child table (`postings`, `import_rows`, `invoice_lines`, `invoice_payments`) for RLS later; `import_rows.operation_type`, `counterparty_account`, `bank_gel_amount_minor`, `counter_amount_minor`, `counter_currency` (ParsedRow fields from `fixtures/statements/bog/FORMAT.md`); `invitations.invited_by/revoked_at`; `invoices.notes` with `number` null until issued; `import_batches.updated_at`.

```
users(id, email unique, name, created_at)
organizations(id, name, tax_id null, base_currency='GEL',
              sbs_effective_from date null, accounting_method enum[cash]='cash', created_at)
memberships(org_id, user_id, role enum[owner|accountant|viewer], pk(org_id,user_id))
invitations(id, org_id, email, role, token_hash, expires_at, accepted_at)

accounts(id, org_id, name, kind enum[asset|liability|equity|income|expense],
         currency null,            -- null = any currency (income/expense); set for bank accounts
         system_key null,          -- 'fx_clearing' | 'tax_payable' | 'owner_equity' ...
         income_class enum[sbs|non_sbs] null,   -- only for kind=income; sbs = 1% and counts toward the limit
         bank enum[tbc|bog|other] null, iban null, archived_at null)

exchange_rates(id, currency, valid_from date, rate numeric(18,6), quantity int,
               source='nbg', set_at timestamptz, fetched_at, unique(currency, valid_from))
  -- lookup for date D = row with greatest valid_from <= D (SPEC §2.3)

transactions(id, org_id, occurred_on date, description, notes null,
             source enum[manual|import|invoice_payment|reversal],
             payment_method enum[cash_register|pos|bank|other] null,  -- return lines 18-21; required when it posts SBS income
             reverses_id null fk transactions, import_batch_id null,
             created_by fk users, created_at)
postings(id, transaction_id, org_id, account_id, amount_minor bigint, currency,
         gel_amount_minor bigint, rate_id null fk exchange_rates)
  -- deferred constraint trigger: per transaction, Σ amount_minor = 0 grouped by currency
  -- trigger: postings are insert-only

import_batches(id, org_id, account_id, bank_format, file_key, file_sha256, file_name,
               status enum[uploaded|parsing|preview|committing|committed|failed],
               stats jsonb, error jsonb null, created_by, created_at)
import_rows(id, batch_id, org_id, row_index, raw jsonb, booked_on date,
            amount_minor bigint, currency, counterparty, description, bank_reference null,
            dedupe_hash, status enum[new|duplicate|skipped],
            suggested_account_id null, chosen_account_id null, transaction_id null)
transaction_fingerprints(org_id, account_id, dedupe_hash, transaction_id,
                         unique(org_id, account_id, dedupe_hash))
categorization_rules(id, org_id, priority, field enum[counterparty|description],
                     op enum[contains|equals|regex], value, target_account_id, is_active)
column_mappings(id, org_id, account_id, mapping jsonb)

clients(id, org_id, name, tax_id null, address null, country, email null, default_currency,
        notes null, archived_at null)
invoices(id, org_id, client_id, number text null, number_year null, number_seq null,
         issue_date null, due_date null, currency, status enum[draft|issued|paid|void],
         bank_account_id null, total_minor bigint, snapshot jsonb null, issued_at, voided_at,
         unique(org_id, number_year, number_seq))
  -- number assigned at issue from invoice_sequences(org_id, year, last_seq), gapless;
  -- issued invoices are immutable apart from status (trigger, ADR 0015)
invoice_lines(id, invoice_id, description, quantity numeric(12,3), unit_price_minor bigint)
invoice_payments(invoice_id, transaction_id, amount_minor)  -- no ledger postings

declaration_filings(id, org_id, period char(7) 'YYYY-MM', version int, supersedes_id null,
             rules_version, income_gel_minor, ytd_gel_minor, rate_bp int,  -- 100 = 1%, 300 = 3%
             by_payment_method jsonb, tax_gel_minor, zero_return, transaction_ids uuid[],
             snapshot jsonb, rs_reference null, filed_by, filed_at,
             unique(org_id, period, version))
  -- insert-only (trigger); a refiling is a correction with version + 1 (ADR 0013).
  -- Live declaration figures are never stored: computed from postings on every read.

audit_log(id, org_id, actor_id, action, entity, entity_id, before jsonb, after jsonb,
          request_id, at)
idempotency_keys(org_id, key, request_hash, status_code, response jsonb, created_at,
                 pk(org_id, key))
```

**Tenancy**: repositories take `orgId` as a required first argument; there is no unscoped query helper for tenant tables. Add Postgres RLS as defence in depth (`SET LOCAL app.org_id` per request transaction) in M5.

## 6. Import pipeline

```
web upload --> api POST /imports (multipart) --> S3 put, import_batches(status=uploaded)
          --> enqueue import.parse
worker import.parse: load file, pick parser (importers), produce rows, compute dedupe_hash,
          mark duplicates against transaction_fingerprints and within batch,
          apply categorization_rules, status=preview, NOTIFY progress
web preview: user adjusts chosen_account_id / skips rows
api POST /imports/:id/commit (Idempotency-Key) --> enqueue import.commit
worker import.commit: one DB transaction per chunk of 500 rows; create transactions+postings
          (rates looked up per booked_on; missing rate -> enqueue rates.backfill and wait/retry),
          insert fingerprints; status=committed
```

`dedupe_hash = sha256(accountId | bookedOn | amountMinor | currency | normalise(bankReference ?? counterparty+description))`. Lives in `domain/dedupe.ts`, unit tested with fixtures.

Parser contract (`packages/importers`):

```ts
interface StatementParser {
  id: 'tbc-csv' | 'tbc-xlsx' | 'bog-csv' | 'bog-xlsx' | 'generic-csv';
  detect(file: Uint8Array, fileName: string): number; // confidence 0..1
  parse(file: Uint8Array, opts: ParseOptions): ParseResult; // { rows: ParsedRow[]; warnings: ParseWarning[] }
}
```

## 7. API conventions (`apps/api`)

- Base path `/v1`. Tenant routes: `/v1/orgs/:orgId/...`. Authorization hook checks membership and role per route (`requireRole('accountant')`).
- Every route declares Zod schemas from `contracts`; OpenAPI is generated and written to `apps/api/openapi.json` by a script. CI fails if the committed spec is stale.
- Errors: RFC 9457 `application/problem+json` with `type`, `title`, `status`, `detail`, `code`, `requestId`.
- Pagination: cursor-based (`?cursor=&limit=`), response `{ items, nextCursor }`.
- Mutations accept `Idempotency-Key`; same key + different body → 422.
- Every mutation runs in one DB transaction that also writes `audit_log`.
- SSE: `GET /v1/orgs/:orgId/events` streams typed events from `contracts/events.ts` (`import.progress`, `import.completed`, `rates.backfilled`, `invoice.pdf_ready`).

Initial route list:

```
POST   /v1/orgs                               GET /v1/orgs
GET    /v1/orgs/:orgId/accounts               POST /v1/orgs/:orgId/accounts
GET    /v1/orgs/:orgId/transactions           POST /v1/orgs/:orgId/transactions
POST   /v1/orgs/:orgId/transactions/:id/reverse
GET    /v1/rates?currency=&from=&to=          POST /v1/rates/backfill (admin)
POST   /v1/orgs/:orgId/imports                GET  /v1/orgs/:orgId/imports/:id
GET    /v1/orgs/:orgId/imports/:id/rows       PATCH /v1/orgs/:orgId/imports/:id/rows/:rowId
POST   /v1/orgs/:orgId/imports/:id/commit
GET|POST|PATCH|DELETE /v1/orgs/:orgId/rules
GET    /v1/orgs/:orgId/declarations?year=     GET  /v1/orgs/:orgId/declarations/:period
POST   /v1/orgs/:orgId/declarations/:period/file
GET    /v1/orgs/:orgId/dashboard?year=
CRUD   /v1/orgs/:orgId/clients, /invoices     POST /v1/orgs/:orgId/invoices/:id/match-payment
GET|POST /v1/orgs/:orgId/members, /invitations
PATCH|DELETE /v1/orgs/:orgId/members/:userId   POST /v1/orgs/:orgId/invitations/:id/(revoke|resend)
GET    /v1/me/sessions                        POST /v1/me/sessions/:sessionId/revoke
GET    /v1/orgs/:orgId/audit-log
```

## 8. Jobs (`apps/worker`)

| Job | Trigger | Notes |
|---|---|---|
| `rates.sync` | cron daily 17:30 and 20:00 Asia/Tbilisi + on boot | Fetch the rate valid from tomorrow (NBG sets it ~17:00). Endpoint and semantics in SPEC §2.3. |
| `rates.backfill` | api / import.commit | Date range; idempotent upsert. Emits `rates.backfilled`. |
| `import.parse` | api | See §6. |
| `import.commit` | api | See §6. |
| ~~`declaration.recompute`~~ | — | Not needed: figures and drift are computed on read (ADR 0013). |
| ~~`invoice.render_pdf`~~ | — | Not needed yet: the API renders the PDF on request (ADR 0015). |

All job payloads are Zod schemas in `contracts/jobs.ts`. Retries with exponential backoff; after max retries, dead-letter queue + Sentry event.

## 9. Web (`apps/web`)

Routes:

```
/(auth)/sign-in, /sign-up, /forgot-password, /reset-password, /invite/[token]
/account                       your name, email, password, sessions
/o/[orgId]/                    dashboard
/o/[orgId]/transactions        virtualised table, filters in URL search params
/o/[orgId]/transactions/new
/o/[orgId]/imports, /imports/new (wizard), /imports/[id] (preview + commit)
/o/[orgId]/declarations, /declarations/[period]
/o/[orgId]/invoices, /clients
/o/[orgId]/settings/(accounts|rules|members|audit)
/accountant                    cross-client overview (M5)
/rates
```

- RSC for reads, streaming with Suspense per dashboard widget. Client components only where interaction needs it.
- Mutations: client components call the typed API client via TanStack Query mutations (optimistic updates for row categorisation). No Server Actions touching business logic; the API is the single write path (ADR 0002).
- Forms: Zod schemas from `contracts` + react-hook-form.
- Tables: TanStack Table + TanStack Virtual.
- Charts: one lightweight library chosen in M3, lazy loaded.
- Money display via `domain/format.ts` (`Intl.NumberFormat`), never ad-hoc.

## 10. Testing strategy

| Layer | Tool | Must cover |
|---|---|---|
| domain | Vitest | money math, rounding, FX conversion, tax rules per effective date, dedupe hash. Property-based tests (fast-check) for balance invariants. |
| importers | Vitest + fixtures | each parser against real anonymised files; malformed files produce warnings, not crashes. |
| db / api | Vitest + Testcontainers Postgres | balance trigger, immutability trigger, tenancy isolation (user A cannot read org B: one test per route, generated from route table), idempotency, audit rows. |
| worker | Vitest + Testcontainers | import end-to-end on fixture, rates backfill with mocked NBG. |
| web | Storybook + interaction tests; Playwright e2e | sign up → create org → import TBC fixture → commit → declaration figures match expected JSON. |
| perf | Lighthouse CI / bundle size check | budgets in `apps/web/perf-budget.json`. |

## 11. CI (GitHub Actions)

Jobs on PR: `install` (pnpm cache) → parallel `typecheck`, `lint`, `unit`, `integration` (service container Postgres), `openapi-drift`, `migration-check` (generate and diff), `build` → `e2e` (compose stack) → `perf`. Turborepo remote cache optional.

## 12. Local dev

```
pnpm i
docker compose up -d --wait # postgres, s3 (RustFS), mailpit
pnpm db:migrate && pnpm db:seed
pnpm dev                    # turbo: web :3000, api :4000, worker
```

Env vars documented in `.env.example` per app; validated at boot with Zod (fail fast).
