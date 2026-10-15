# 0002 Separate Fastify API instead of Next.js-only backend

Status: accepted (versions pinned in WS-00, 2026-10-15)

## Context
The app needs background jobs, long-running imports, SSE, an audit and idempotency layer on every write, and a documented contract.

## Decision
Business logic and all writes live in a Fastify API with Zod schemas and generated OpenAPI. Next.js renders UI and reads through the typed client (openapi-typescript + openapi-fetch). No Server Actions with business logic.

## Pinned versions

| Package | Version |
|---|---|
| fastify | 5.12.7 |
| fastify-type-provider-zod | 7.0.0 (serialises from `z.output` through Zod's `encode`) |
| @fastify/swagger | 9.9.2 (OpenAPI 3.1) |
| @fastify/cors | 11.3.1 |
| zod | 4.6.7 |
| pino | 10.4.0 |
| next | 16.4.1 (App Router, Turbopack) |
| react / react-dom | 19.3.1 |
| tailwindcss | 4.3.3 |
| openapi-typescript | 7.13.0 (declares `typescript ^5`; works with 6.0.3) |
| openapi-fetch | 0.17.0 |

Notes from wiring them together:
- Money is a Zod codec (`"125000"` on the wire, `125000n` in code). JSON Schema has no bigint, so `apps/api/src/openapi.ts` documents bigint nodes as the integer string they encode to. Without that, response money fields came out as `{}`.
- Every schema with `.meta({ id })` becomes an OpenAPI component (`Foo` for responses, `FooInput` for requests).
- Fastify 5.12 deprecates top-level `requestIdLogLabel`; the API uses `logController`.
- The web lint config uses `@next/eslint-plugin-next` and `eslint-plugin-react-hooks` directly. `eslint-config-next` also pulls in `eslint-plugin-react` and `eslint-plugin-jsx-a11y`, which do not yet declare ESLint 10 support.

## Alternatives
- Next.js Route Handlers + Server Actions only: fewer moving parts, but couples domain to the web framework, no single write path for the worker, weaker contract story.
- NestJS: heavier DI framework than needed.
- tRPC: good DX but no language-neutral contract.

## Consequences
Two deployables plus worker. CORS/cookie setup across subdomains. Contract drift caught in CI by the OpenAPI diff check.
