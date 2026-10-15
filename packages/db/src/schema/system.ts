import { index, integer, jsonb, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, timestamptz } from './_columns';
import { users } from './auth';
import { organizations } from './tenancy';

/** One row per mutation, written in the same DB transaction (CLAUDE.md hard rules). */
export const auditLog = pgTable(
  'audit_log',
  {
    id: id(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    /** null for system actions (worker jobs). */
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    entity: text('entity').notNull(),
    entityId: text('entity_id'),
    before: jsonb('before').$type<Record<string, unknown>>(),
    after: jsonb('after').$type<Record<string, unknown>>(),
    requestId: text('request_id'),
    at: timestamptz('at').notNull().defaultNow(),
  },
  (t) => [index('audit_log_org_at_idx').on(t.orgId, t.at)],
);

/**
 * Stored responses for `Idempotency-Key` (ARCHITECTURE §7, ADR 0010).
 *
 * A key is scoped to (org, user). `org_id` is null for mutations that have no org yet
 * (`POST /v1/orgs`, accepting an invitation); NULLS NOT DISTINCT keeps (null, user, key) unique.
 * The row is inserted in the request's own transaction before the handler runs, so a concurrent
 * request with the same key waits on the unique index until the first commits or rolls back.
 */
export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    id: id(),
    orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    requestHash: text('request_hash').notNull(),
    /** null only inside the transaction that is still running the request. */
    statusCode: integer('status_code'),
    response: jsonb('response'),
    createdAt: createdAt(),
  },
  (t) => [
    unique('idempotency_keys_scope_key_uq').on(t.orgId, t.userId, t.key).nullsNotDistinct(),
    index('idempotency_keys_created_at_idx').on(t.createdAt),
  ],
);
