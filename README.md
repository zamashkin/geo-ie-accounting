# IE Ledger

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
pnpm db:seed                 # demo user, demo org, default chart of accounts
pnpm dev                     # web :3000, api :4000, worker
```

Open http://localhost:3000. The home page asks the API for `/healthz` and shows its status. The API's OpenAPI spec is in `apps/api/openapi.json`.

`docker compose down` stops the services. Add `-v` to delete the database and bucket volumes too.

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

You can also skip containers and use the compose database: `TEST_DATABASE_URL=postgres://ie_ledger:ie_ledger@localhost:5432/postgres pnpm test:integration`.

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
