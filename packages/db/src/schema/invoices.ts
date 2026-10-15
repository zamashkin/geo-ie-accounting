import { sql } from 'drizzle-orm';
import {
  char,
  check,
  date,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, currency, id, minor, timestamptz } from './_columns';
import { invoiceStatusEnum } from './enums';
import { transactions } from './ledger';
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
    /** ISO 3166-1 alpha-2. */
    country: char('country', { length: 2 }).notNull(),
    email: text('email'),
    defaultCurrency: currency('default_currency').notNull(),
    archivedAt: timestamptz('archived_at'),
    createdAt: createdAt(),
  },
  (t) => [index('clients_org_id_idx').on(t.orgId)],
);

export const invoices = pgTable(
  'invoices',
  {
    id: id(),
    orgId: orgId(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id),
    /** Assigned on issue, gapless per org (WS-09). null while draft. */
    number: integer('number'),
    issueDate: date('issue_date', { mode: 'string' }),
    dueDate: date('due_date', { mode: 'string' }),
    currency: currency('currency').notNull(),
    status: invoiceStatusEnum('status').notNull().default('draft'),
    pdfKey: text('pdf_key'),
    notes: text('notes'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('invoices_org_number_uq').on(t.orgId, t.number),
    index('invoices_org_status_idx').on(t.orgId, t.status),
    check('invoices_number_when_issued', sql`(${t.status} = 'draft') = (${t.number} is null)`),
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
  (t) => [uniqueIndex('invoice_lines_invoice_position_uq').on(t.invoiceId, t.position)],
);

export const invoicePayments = pgTable(
  'invoice_payments',
  {
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id),
    transactionId: uuid('transaction_id')
      .notNull()
      .references(() => transactions.id),
    orgId: orgId(),
    amountMinor: minor('amount_minor').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.invoiceId, t.transactionId] }),
    check('invoice_payments_amount_positive', sql`${t.amountMinor} > 0`),
  ],
);
