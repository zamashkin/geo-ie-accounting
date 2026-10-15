import { sql } from 'drizzle-orm';
import {
  boolean,
  char,
  check,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { id, minor, timestamptz } from './_columns';
import { users } from './auth';
import { declarationStatusEnum } from './enums';
import { organizations } from './tenancy';

/** SBS income by payment method in GEL minor units, as decimal strings (return lines 18–21). */
export type IncomeByPaymentMethodJson = {
  cash_register: string;
  pos: string;
  bank: string;
  other: string;
};

export const declarations = pgTable(
  'declarations',
  {
    id: id(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    /** 'YYYY-MM' */
    period: char('period', { length: 7 }).notNull(),
    status: declarationStatusEnum('status').notNull().default('draft'),
    turnoverGelMinor: minor('turnover_gel_minor').notNull(),
    /** Cumulative SBS income since 1 January (return line 15). */
    ytdGelMinor: minor('ytd_gel_minor').notNull(),
    /** 100 = 1%, 300 = 3%. */
    rateBp: integer('rate_bp').notNull(),
    byPaymentMethod: jsonb('by_payment_method').$type<IncomeByPaymentMethodJson>().notNull(),
    taxGelMinor: minor('tax_gel_minor').notNull(),
    rulesVersion: text('rules_version').notNull(),
    /** Immutable figures stored when filed. */
    snapshot: jsonb('snapshot').$type<Record<string, unknown>>(),
    /** Live figures differ from the filed snapshot (WS-08). */
    hasDrift: boolean('has_drift').notNull().default(false),
    computedAt: timestamptz('computed_at').notNull().defaultNow(),
    filedAt: timestamptz('filed_at'),
    filedBy: uuid('filed_by').references(() => users.id),
  },
  (t) => [
    uniqueIndex('declarations_org_period_uq').on(t.orgId, t.period),
    check('declarations_period_format', sql`${t.period} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
    check('declarations_rate_bp_nonnegative', sql`${t.rateBp} >= 0`),
    check(
      'declarations_filed_fields',
      sql`(${t.status} = 'filed') = (${t.filedAt} is not null and ${t.snapshot} is not null)`,
    ),
  ],
);
