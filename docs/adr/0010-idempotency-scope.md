# 0010 Idempotency keys are scoped to (org, user)

Status: accepted (WS-05, 2026-10-15)

## Context
ARCHITECTURE §5 keyed `idempotency_keys` by `(org_id, key)`. Two cases don't fit that:

- `POST /v1/orgs` and `POST /v1/invitations/accept` have no org in the URL. The first creates the org; for the second the caller isn't a member yet.
- With `(org_id, key)`, two members of one org who happen to send the same key would collide. The second would get the first one's stored response (it belongs to another user) or a 422.

## Decision
A key is scoped to **(org_id, user_id, key)**. `org_id` is nullable and is null for mutations with no org. The table gets a surrogate `id` primary key and a `UNIQUE NULLS NOT DISTINCT (org_id, user_id, key)` constraint (Postgres 15+), so `(null, user, key)` is unique as well. Migration `0002_idempotency_scope`.

How it runs (`apps/api/src/plugins/mutations.ts`):

1. The request hash is sha256 over the method, the URL and the JSON body as received.
2. The mutating handler runs inside one DB transaction. Before it runs, that transaction inserts the key row with `ON CONFLICT DO NOTHING`.
3. A concurrent request with the same key blocks on the unique index until the first transaction ends. If the first commits, the second sees the stored response. If it rolls back, the second claims the key itself. Nothing ever has to expose or poll an "in progress" state.
4. Same hash: the stored status and body are replayed with `Idempotent-Replayed: true`. Different hash: 422 `idempotency_key_reused`.
5. The response is written in the same transaction as the mutation and its audit row. A request that fails (4xx/5xx) rolls back and leaves nothing stored, so a retry with the same key runs again.
6. Keys are replayed for 24 h. After that a key counts as unused. `deleteExpiredIdempotencyKeys` is there for a scheduled cleanup job.

## Alternatives
- **User-only scope `(user_id, key)`**: simpler, but it drops `org_id`, which RLS (M5) needs on every tenant table.
- **Nullable org with a partial unique index `WHERE org_id IS NULL`**: needs two indexes and two `ON CONFLICT` targets. NULLS NOT DISTINCT does the same job with one constraint.
- **A separate "in progress" status that other requests poll**: more code. It also needs timeouts for crashed requests, which the row lock gives us for free.

## Consequences
A blocked duplicate holds a pooled connection while it waits. That's acceptable at this scale; a `lock_timeout` can be added if it becomes a problem. Errors are not replayed, which is a deliberate choice: retrying a failed request should re-run it.
