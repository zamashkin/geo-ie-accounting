# WS-05 Auth + tenancy

**Phase 1.**

## Owns
`apps/api/src/auth/**`, `apps/api/src/plugins/**` (authz, audit, idempotency), `apps/api/src/routes/orgs/**`, `apps/api/src/routes/members/**`, `packages/db/src/repositories/{orgs,members,audit,idempotency}.ts`

## Deliver
- Better Auth in the API: email+password and magic link (mail via Mailpit locally), httpOnly secure session cookie, CSRF protection for cookie auth.
- Fastify plugins:
  - `requireAuth`, `requireRole(min)` with role order `viewer < accountant < owner`, resolving membership from `:orgId`.
  - `withTx`: one DB transaction per mutating request, exposed as `req.tx`.
  - `audit(entity, id, before, after)` writing to `audit_log` inside `req.tx`.
  - `idempotency`: `Idempotency-Key` handling per ARCHITECTURE §7.
- Routes: create/list orgs (creating an org seeds the chart of accounts via a `db` function), members list, invitations create/accept/revoke.
- **Tenancy test harness**: a helper that, given the route table, asserts every `/v1/orgs/:orgId/*` route returns 404 for a user without membership in that org. Other workstreams add their routes to it automatically.

## Acceptance
- Integration tests for every role boundary and the cross-tenant harness.
- Replaying a POST with the same key returns the stored response; a different body returns 422.
