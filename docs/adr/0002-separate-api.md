# 0002 Separate Fastify API instead of Next.js-only backend

Status: accepted

## Context
The app needs background jobs, long-running imports, SSE, an audit and idempotency layer on every write, and a documented contract.

## Decision
Business logic and all writes live in a Fastify API with Zod schemas and generated OpenAPI. Next.js renders UI and reads through the typed client (openapi-typescript + openapi-fetch). No Server Actions with business logic.

## Alternatives
- Next.js Route Handlers + Server Actions only: fewer moving parts, but couples domain to the web framework, no single write path for the worker, weaker contract story.
- NestJS: heavier DI framework than needed.
- tRPC: good DX but no language-neutral contract.

## Consequences
Two deployables plus worker. CORS/cookie setup across subdomains. Contract drift caught in CI by the OpenAPI diff check.
