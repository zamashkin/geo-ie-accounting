import { sql } from 'drizzle-orm';
import { check, date, index, pgTable, primaryKey, text, uuid } from 'drizzle-orm/pg-core';
import { createdAt, currency, id, timestamptz } from './_columns';
import { users } from './auth';
import { accountingMethodEnum, roleEnum } from './enums';

export const organizations = pgTable(
  'organizations',
  {
    id: id(),
    name: text('name').notNull(),
    taxId: text('tax_id'),
    baseCurrency: currency('base_currency').notNull().default('GEL'),
    /** Small-business status start; may be mid-month (SPEC §2.1). */
    sbsEffectiveFrom: date('sbs_effective_from', { mode: 'string' }),
    accountingMethod: accountingMethodEnum('accounting_method').notNull().default('cash'),
    createdAt: createdAt(),
  },
  (t) => [check('organizations_base_currency_gel', sql`${t.baseCurrency} = 'GEL'`)],
);

export const memberships = pgTable(
  'memberships',
  {
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: roleEnum('role').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.userId] }),
    index('memberships_user_id_idx').on(t.userId),
  ],
);

export const invitations = pgTable(
  'invitations',
  {
    id: id(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: roleEnum('role').notNull(),
    /** sha256 of the invitation token; the token itself is never stored. */
    tokenHash: text('token_hash').notNull().unique(),
    invitedBy: uuid('invited_by').references(() => users.id, { onDelete: 'set null' }),
    expiresAt: timestamptz('expires_at').notNull(),
    acceptedAt: timestamptz('accepted_at'),
    revokedAt: timestamptz('revoked_at'),
    createdAt: createdAt(),
  },
  (t) => [index('invitations_org_id_idx').on(t.orgId)],
);
