import type { InvoiceSnapshot } from '@ie-ledger/contracts';
import { sql } from 'drizzle-orm';
import {
  char,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, currency, id, minor, timestamptz } from './_columns';
import { invoiceStatusEnum } from './enums';
import { accounts, transactions } from './ledger';
import { organizations } from './tenancy';

const orgId = () =>
  uuid('org_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' });

export const clients = pgTable(
  'clients',
  {
    id: id(),
    orgId: orgId(),
    name: text('name').notNull(),
    taxId: text('tax_id'),
    address: text('address'),
    /** ISO 3166-1 alpha-2. */
    country: char('country', { length: 2 }).notNull(),
    email: text('email'),
    defaultCurrency: currency('default_currency').notNull(),
    notes: text('notes'),
    archivedAt: timestamptz('archived_at'),
    createdAt: createdAt(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('clients_org_id_idx').on(t.orgId),
    // Composite target for invoices' (client_id, org_id) FK.
    unique('clients_id_org_id_uq').on(t.id, t.orgId),
  ],
);

/**
 * Draft → issued → paid / void. A draft has no number; issuing takes the next one of the issue
 * year from `invoice_sequences` in the same transaction, so numbers are gapless per org and year
 * and a void invoice keeps its number. Issued invoices are immutable apart from the status
 * (trigger `invoices_issued_immutable`, migration 0006).
 */
export const invoices = pgTable(
  'invoices',
  {
    id: id(),
    orgId: orgId(),
    clientId: uuid('client_id').notNull(),
    /** Formatted number (`INV-2026-001`), frozen at issue. null while draft. */
    number: text('number'),
    numberYear: integer('number_year'),
    numberSeq: integer('number_seq'),
    issueDate: date('issue_date', { mode: 'string' }),
    dueDate: date('due_date', { mode: 'string' }),
    currency: currency('currency').notNull(),
    status: invoiceStatusEnum('status').notNull().default('draft'),
    /** Bank account printed for payment (its IBAN). */
    bankAccountId: uuid('bank_account_id'),
    notes: text('notes'),
    /** Σ line totals from packages/domain computeInvoiceTotals, kept for list aggregates. */
    totalMinor: minor('total_minor')
      .notNull()
      .default(sql`0`),
    /** Seller, client and bank details as printed, frozen at issue. null while draft. */
    snapshot: jsonb('snapshot').$type<InvoiceSnapshot>(),
    issuedAt: timestamptz('issued_at'),
    voidedAt: timestamptz('voided_at'),
    createdAt: createdAt(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('invoices_org_year_seq_uq').on(t.orgId, t.numberYear, t.numberSeq),
    uniqueIndex('invoices_org_number_uq').on(t.orgId, t.number),
    index('invoices_org_status_idx').on(t.orgId, t.status),
    index('invoices_org_client_idx').on(t.orgId, t.clientId),
    unique('invoices_id_org_id_uq').on(t.id, t.orgId),
    foreignKey({
      name: 'invoices_client_fk',
      columns: [t.clientId, t.orgId],
      foreignColumns: [clients.id, clients.orgId],
    }),
    foreignKey({
      name: 'invoices_bank_account_fk',
      columns: [t.bankAccountId, t.orgId],
      foreignColumns: [accounts.id, accounts.orgId],
    }),
    check(
      'invoices_number_when_issued',
      sql`((${t.status} = 'draft') = (${t.number} is null)) and ((${t.number} is null) = (${t.numberYear} is null)) and ((${t.number} is null) = (${t.numberSeq} is null))`,
    ),
    check(
      'invoices_dates_when_issued',
      sql`${t.status} = 'draft' or (${t.issueDate} is not null and ${t.dueDate} is not null and ${t.snapshot} is not null)`,
    ),
    check(
      'invoices_due_after_issue',
      sql`${t.issueDate} is null or ${t.dueDate} is null or ${t.dueDate} >= ${t.issueDate}`,
    ),
    check('invoices_total_nonnegative', sql`${t.totalMinor} >= 0`),
  ],
);

export const invoiceLines = pgTable(
  'invoice_lines',
  {
    id: id(),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'cascade' }),
    orgId: orgId(),
    position: integer('position').notNull(),
    description: text('description').notNull(),
    quantity: numeric('quantity', { precision: 12, scale: 3, mode: 'string' }).notNull(),
    unitPriceMinor: minor('unit_price_minor').notNull(),
  },
  (t) => [
    uniqueIndex('invoice_lines_invoice_position_uq').on(t.invoiceId, t.position),
    check('invoice_lines_quantity_positive', sql`${t.quantity} > 0`),
    check('invoice_lines_unit_price_nonnegative', sql`${t.unitPriceMinor} >= 0`),
  ],
);

export const invoicePayments = pgTable(
  'invoice_payments',
  {
    invoiceId: uuid('invoice_id').notNull(),
    transactionId: uuid('transaction_id').notNull(),
    orgId: orgId(),
    amountMinor: minor('amount_minor').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.invoiceId, t.transactionId] }),
    index('invoice_payments_org_transaction_idx').on(t.orgId, t.transactionId),
    // The invoice and the bank transaction belong to the payment's org.
    foreignKey({
      name: 'invoice_payments_invoice_fk',
      columns: [t.invoiceId, t.orgId],
      foreignColumns: [invoices.id, invoices.orgId],
    }),
    foreignKey({
      name: 'invoice_payments_transaction_fk',
      columns: [t.transactionId, t.orgId],
      foreignColumns: [transactions.id, transactions.orgId],
    }),
    check('invoice_payments_amount_positive', sql`${t.amountMinor} > 0`),
  ],
);

/**
 * Last invoice sequence per org and year. Issuing increments it with an upsert that holds the
 * row lock until COMMIT: concurrent issues queue up, and a rolled-back issue gives its number
 * back, so the numbers stay gapless.
 */
export const invoiceSequences = pgTable(
  'invoice_sequences',
  {
    orgId: orgId(),
    year: integer('year').notNull(),
    lastSeq: integer('last_seq').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.year] }),
    check('invoice_sequences_last_seq_positive', sql`${t.lastSeq} > 0`),
  ],
);
