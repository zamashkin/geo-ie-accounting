# geo-ie-accounting

**[Architecture map](https://htmlpreview.github.io/?https://github.com/zamashkin/geo-ie-accounting/blob/main/docs/architecture-map.html)**: the parts of the app and how they fit together ([source](docs/architecture-map.html)).

**[API reference (Swagger)](https://htmlpreview.github.io/?https://github.com/zamashkin/geo-ie-accounting/blob/main/docs/api.html)**: every endpoint, generated from the Zod contracts.

Bookkeeping and tax figures for individual entrepreneurs in Georgia on the 1% small business regime. Import your TBC or Bank of Georgia statements, and the app converts foreign-currency income to GEL at the official NBG rate for each receipt date, keeps a double-entry ledger, and shows what to declare each month.

Status: foundation (WS-00). The web app, API and worker boot and talk to each other; the features come next.

- [MVP plan (current focus)](docs/MVP.md)
- [Product spec](docs/SPEC.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Decision records](docs/adr/)
- [Work plan](docs/tasks/README.md)

Stack: Next.js, Fastify, PostgreSQL + Drizzle, pg-boss, TypeScript throughout.

## Getting started

You need Node.js 24 (`.nvmrc`), pnpm 11 (`corepack enable` picks up the version from `package.json`) and Docker with Compose.

```sh
pnpm install
pnpm env:init                # copies each .env.example to .env (skips existing files)
docker compose up -d --wait  # postgres :5432, S3 (RustFS) :9000/:9001, mailpit :1025/:8025
pnpm db:migrate
pnpm db:seed                 # dev login, an empty dev workspace, default chart of accounts
pnpm dev                     # web :3000, api :4000, worker
```

Open http://localhost:3000. The home page asks the API for `/healthz` and shows its status. The API's OpenAPI spec is in `apps/api/openapi.json`, and Swagger UI runs at http://localhost:4000/docs (on by default outside production; set `API_DOCS=true` or `false` to choose). Sign in on the web app first and "Try it out" sends your session cookie. Reads work from there; changes are refused by the CSRF origin check, so make them from the web app.

`docker compose down` stops the services. Add `-v` to delete the database and bucket volumes too.

The dev login is `dev@geo-ie-accounting.local` / `dev-password-2026`, owner of an empty workspace.

## Try the demo

The demo has two made-up workspaces with almost two years of bookkeeping each, and a read-only login that can open both.

```sh
pnpm db:migrate
pnpm db:seed:demo            # builds the demo workspaces and the read-only login
DEMO_MODE=true pnpm dev      # or set DEMO_MODE=true in apps/api/.env
```

On the sign-in page, press **Try the demo**, or sign in as `demo@geo-ie-accounting.local` / `try-the-demo-2026`.

- `Demo: IT freelancer` is a Georgian IE with five foreign clients paying in USD, EUR and GBP. Income arrives through monthly Bank of Georgia statement imports, gets converted to GEL, and goes out again as expenses, owner draws and the monthly tax. The workspace has returns filed for every month, one correction (a statement imported late), one filed month changed by a reversal, one overdue month, invoices in every status, categorisation rules and an unfinished import.
- `Demo: high earner` passes the GEL 500,000 annual limit in mid-2025, so you can see the 3% rate for the rest of that year.

The data runs up to yesterday. Run `pnpm db:seed:demo` again on another day to move it along: the old demo workspaces are retired and new ones built. Set `DEMO_TODAY=YYYY-MM-DD` to pin the date (the output is the same on every run), or pass `--force` to rebuild anyway. The NBG rates are real, recorded in `fixtures/nbg/demo-rates.json`. Every name, company and IBAN is fictional.

The API refuses every change by the demo login with 403 `demo_read_only`, including password and email changes. To host the demo publicly, run the API with `DEMO_MODE=true`, and with `DEMO_SIGNUP=false` if strangers shouldn't be able to create accounts. Details: [ADR 0016](docs/adr/0016-public-demo.md).

### Checks

```sh
pnpm turbo typecheck lint test   # what CI runs per package
pnpm format:check
pnpm test:integration            # real Postgres, see below
pnpm gen:api                     # regenerate openapi.json and the web client types after API changes
pnpm db:generate                 # new migration after a schema change in packages/db/src/schema
```

Integration tests (`*.int.test.ts`) run against a real Postgres 17. With `TEST_DATABASE_URL` set (CI does this), each test file creates and drops its own database on that server. Without it, Testcontainers starts a throwaway container.

Testcontainers looks for Docker at `/var/run/docker.sock`. Docker Desktop provides it; OrbStack and Colima may not. In that case point it at your engine's socket, for example with OrbStack:

```sh
export DOCKER_HOST=unix://$HOME/.orbstack/run/docker.sock
```

You can also skip containers and use the compose database: `TEST_DATABASE_URL=postgres://geo_ie_accounting:geo_ie_accounting@localhost:5432/postgres pnpm test:integration`.

### Layout

```
apps/web         Next.js App Router. UI only, talks to the API over HTTP.
apps/api         Fastify: routes, auth, OpenAPI.
apps/worker      pg-boss jobs.
packages/contracts  Zod schemas shared by everything: money, DTOs, jobs, events.
packages/db      Drizzle schema, migrations (with the ledger triggers), seed.
packages/domain  Money, FX and tax rules. Pure functions.
packages/importers  Bank statement parsers. Pure functions.
packages/nbg     National Bank of Georgia rates client.
packages/ui      Design-system components.
packages/config  Shared tsconfig, ESLint (including the package dependency rules), Prettier, Vitest.
```

Workspace packages are consumed as TypeScript source. The apps compile them: Next.js through `transpilePackages`, the API and worker through an esbuild bundle (`pnpm build`).
