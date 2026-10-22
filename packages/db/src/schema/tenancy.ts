import { sql } from 'drizzle-orm';
import { check, date, index, integer, pgTable, primaryKey, text, uuid } from 'drizzle-orm/pg-core';
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
    // Invoice profile (WS-09): the seller's details printed on invoices.
    address: text('address'),
    email: text('email'),
    phone: text('phone'),
    /** Prepended to invoice numbers (`INV-` → `INV-2026-001`). */
    invoicePrefix: text('invoice_prefix'),
    /** Issue → due date when an invoice is issued without one. */
    invoiceDueDays: integer('invoice_due_days').notNull().default(14),
    invoiceNote: text('invoice_note'),
    /**
     * Set on workspaces made by `pnpm db:seed:demo`: which generator run built it (profile,
     * version, "today"). A re-run with the same value leaves the workspace alone.
     */
    demoSeed: text('demo_seed'),
    createdAt: createdAt(),
  },
  (t) => [
    check('organizations_base_currency_gel', sql`${t.baseCurrency} = 'GEL'`),
    check('organizations_invoice_due_days_range', sql`${t.invoiceDueDays} between 0 and 365`),
  ],
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
