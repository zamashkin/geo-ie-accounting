// Invoices (WS-09): drafts, issue with gapless numbering, payments allocated from imported bank
// transactions. Totals are computed by packages/domain and stored on the invoice for the list
// aggregates; this module only stores and aggregates.
import type { InvoiceStatus } from '@ie-ledger/contracts';
import { and, asc, desc, eq, inArray, lt, sql, type SQL } from 'drizzle-orm';
import type { DbOrTx, Tx } from '../client';
import {
  clients,
  importRows,
  invoiceLines,
  invoicePayments,
  invoiceSequences,
  invoices,
  transactions,
} from '../schema/index';

export type InvoiceRow = typeof invoices.$inferSelect;
export type InvoiceLineRow = typeof invoiceLines.$inferSelect;
export type InvoicePaymentRow = typeof invoicePayments.$inferSelect;

export interface NewInvoiceLine {
  description: string;
  quantity: string;
  unitPriceMinor: bigint;
}

export type NewInvoice = Pick<
  typeof invoices.$inferInsert,
  'clientId' | 'currency' | 'issueDate' | 'dueDate' | 'bankAccountId' | 'notes' | 'totalMinor'
>;

/** Fields that change on a draft, or on issue / status changes. */
export type InvoicePatch = Partial<
  Omit<typeof invoices.$inferInsert, 'id' | 'orgId' | 'createdAt' | 'updatedAt'>
>;

/** An invoice with its client name and Σ payments. */
export interface InvoiceListRow extends InvoiceRow {
  clientName: string;
  paidMinor: bigint;
}

/** Σ invoice_payments.amount_minor per invoice. */
const paidSum = (orgId: string) =>
  sql<bigint>`coalesce((select sum(${invoicePayments.amountMinor}) from ${invoicePayments}
    where ${invoicePayments.orgId} = ${orgId} and ${invoicePayments.invoiceId} = ${invoices.id}), 0)::bigint`.mapWith(
    BigInt,
  );

export interface InvoiceFilter {
  status?: InvoiceStatus | undefined;
  /** Issued and due before this date. */
  overdueBefore?: string | undefined;
  clientId?: string | undefined;
}

/** Newest first (uuid v7 ids are time-ordered); up to `limit + 1` rows to tell a next page. */
export async function listInvoices(
  db: DbOrTx,
  orgId: string,
  filter: InvoiceFilter,
  page: { afterId?: string | undefined; limit: number },
): Promise<InvoiceListRow[]> {
  const where: (SQL | undefined)[] = [
    eq(invoices.orgId, orgId),
    filter.status ? eq(invoices.status, filter.status) : undefined,
    filter.clientId ? eq(invoices.clientId, filter.clientId) : undefined,
    filter.overdueBefore
      ? and(eq(invoices.status, 'issued'), lt(invoices.dueDate, filter.overdueBefore))
      : undefined,
    page.afterId ? lt(invoices.id, page.afterId) : undefined,
  ];
  const rows = await db
    .select({ invoice: invoices, clientName: clients.name, paidMinor: paidSum(orgId) })
    .from(invoices)
    .innerJoin(clients, and(eq(clients.id, invoices.clientId), eq(clients.orgId, orgId)))
    .where(and(...where))
    .orderBy(desc(invoices.id))
    .limit(page.limit + 1);
  return rows.map((r) => ({ ...r.invoice, clientName: r.clientName, paidMinor: r.paidMinor }));
}

export async function getInvoice(
  db: DbOrTx,
  orgId: string,
  invoiceId: string,
): Promise<InvoiceListRow | null> {
  const [row] = await db
    .select({ invoice: invoices, clientName: clients.name, paidMinor: paidSum(orgId) })
    .from(invoices)
    .innerJoin(clients, and(eq(clients.id, invoices.clientId), eq(clients.orgId, orgId)))
    .where(and(eq(invoices.orgId, orgId), eq(invoices.id, invoiceId)));
  return row ? { ...row.invoice, clientName: row.clientName, paidMinor: row.paidMinor } : null;
}

/** Locks the invoice row until the transaction ends (edit, issue, void, payments). */
export async function lockInvoice(
  tx: Tx,
  orgId: string,
  invoiceId: string,
): Promise<InvoiceRow | null> {
  const [row] = await tx
    .select()
    .from(invoices)
    .where(and(eq(invoices.orgId, orgId), eq(invoices.id, invoiceId)))
    .for('update');
  return row ?? null;
}

export async function listInvoiceLines(
  db: DbOrTx,
  orgId: string,
  invoiceId: string,
): Promise<InvoiceLineRow[]> {
  return db
    .select()
    .from(invoiceLines)
    .where(and(eq(invoiceLines.orgId, orgId), eq(invoiceLines.invoiceId, invoiceId)))
    .orderBy(asc(invoiceLines.position));
}

async function insertLines(
  tx: Tx,
  orgId: string,
  invoiceId: string,
  lines: readonly NewInvoiceLine[],
) {
  if (lines.length === 0) return;
  await tx.insert(invoiceLines).values(
    lines.map((l, position) => ({
      invoiceId,
      orgId,
      position,
      description: l.description,
      quantity: l.quantity,
      unitPriceMinor: l.unitPriceMinor,
    })),
  );
}

export async function createInvoice(
  tx: Tx,
  orgId: string,
  values: NewInvoice,
  lines: readonly NewInvoiceLine[],
): Promise<InvoiceRow> {
  const [row] = await tx
    .insert(invoices)
    .values({ ...values, orgId, status: 'draft' })
    .returning();
  if (!row) throw new Error('invoice insert returned no row');
  await insertLines(tx, orgId, row.id, lines);
  return row;
}

/** Replaces every line of a draft (the trigger refuses it on an issued invoice). */
export async function replaceInvoiceLines(
  tx: Tx,
  orgId: string,
  invoiceId: string,
  lines: readonly NewInvoiceLine[],
): Promise<void> {
  await tx
    .delete(invoiceLines)
    .where(and(eq(invoiceLines.orgId, orgId), eq(invoiceLines.invoiceId, invoiceId)));
  await insertLines(tx, orgId, invoiceId, lines);
}

export async function updateInvoice(
  tx: Tx,
  orgId: string,
  invoiceId: string,
  patch: InvoicePatch,
): Promise<InvoiceRow> {
  const [row] = await tx
    .update(invoices)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(invoices.orgId, orgId), eq(invoices.id, invoiceId)))
    .returning();
  if (!row) throw new Error('invoice update returned no row');
  return row;
}

/** Deletes a draft and its lines. The trigger refuses issued invoices. */
export async function deleteInvoice(tx: Tx, orgId: string, invoiceId: string): Promise<boolean> {
  const rows = await tx
    .delete(invoices)
    .where(and(eq(invoices.orgId, orgId), eq(invoices.id, invoiceId)))
    .returning({ id: invoices.id });
  return rows.length > 0;
}

/**
 * The next invoice sequence of `year` for the org: 1, 2, 3, ... The upsert takes the sequence
 * row's lock and holds it until the request transaction ends, so concurrent issues in the same
 * org and year run one after another, and a rolled-back issue returns its number. Gapless.
 */
export async function nextInvoiceSequence(tx: Tx, orgId: string, year: number): Promise<number> {
  const [row] = await tx
    .insert(invoiceSequences)
    .values({ orgId, year, lastSeq: 1 })
    .onConflictDoUpdate({
      target: [invoiceSequences.orgId, invoiceSequences.year],
      set: { lastSeq: sql`${invoiceSequences.lastSeq} + 1` },
    })
    .returning({ lastSeq: invoiceSequences.lastSeq });
  if (!row) throw new Error('invoice sequence upsert returned no row');
  return row.lastSeq;
}

// ── Payments ────────────────────────────────────────────────────────────────────────────

export interface InvoicePaymentDetail extends InvoicePaymentRow {
  occurredOn: string;
  description: string;
  counterparty: string | null;
}

/** The counterparty of the first `new` import row behind a transaction. */
const counterpartyOf = (orgId: string) =>
  sql<string | null>`(select ${importRows.counterparty} from ${importRows}
    where ${importRows.orgId} = ${orgId} and ${importRows.transactionId} = ${transactions.id}
      and ${importRows.status} = 'new'
    order by ${importRows.rowIndex} limit 1)`;

export async function listInvoicePayments(
  db: DbOrTx,
  orgId: string,
  invoiceId: string,
): Promise<InvoicePaymentDetail[]> {
  const rows = await db
    .select({
      payment: invoicePayments,
      occurredOn: transactions.occurredOn,
      description: transactions.description,
      counterparty: counterpartyOf(orgId),
    })
    .from(invoicePayments)
    .innerJoin(
      transactions,
      and(eq(transactions.id, invoicePayments.transactionId), eq(transactions.orgId, orgId)),
    )
    .where(and(eq(invoicePayments.orgId, orgId), eq(invoicePayments.invoiceId, invoiceId)))
    .orderBy(asc(transactions.occurredOn), asc(invoicePayments.createdAt));
  return rows.map((r) => ({
    ...r.payment,
    occurredOn: r.occurredOn,
    description: r.description,
    counterparty: r.counterparty,
  }));
}

export async function insertInvoicePayment(
  tx: Tx,
  orgId: string,
  values: { invoiceId: string; transactionId: string; amountMinor: bigint },
): Promise<InvoicePaymentRow> {
  const [row] = await tx
    .insert(invoicePayments)
    .values({ ...values, orgId })
    .returning();
  if (!row) throw new Error('invoice payment insert returned no row');
  return row;
}

export async function deleteInvoicePayment(
  tx: Tx,
  orgId: string,
  invoiceId: string,
  transactionId: string,
): Promise<InvoicePaymentRow | null> {
  const [row] = await tx
    .delete(invoicePayments)
    .where(
      and(
        eq(invoicePayments.orgId, orgId),
        eq(invoicePayments.invoiceId, invoiceId),
        eq(invoicePayments.transactionId, transactionId),
      ),
    )
    .returning();
  return row ?? null;
}

/** Σ payments of one invoice. */
export async function invoicePaidTotal(
  db: DbOrTx,
  orgId: string,
  invoiceId: string,
): Promise<bigint> {
  const [row] = await db
    .select({
      total: sql<bigint>`coalesce(sum(${invoicePayments.amountMinor}), 0)::bigint`.mapWith(BigInt),
    })
    .from(invoicePayments)
    .where(and(eq(invoicePayments.orgId, orgId), eq(invoicePayments.invoiceId, invoiceId)));
  return row?.total ?? 0n;
}

/** Invoices a transaction pays, with what it allocates to each. */
export async function listTransactionAllocations(
  db: DbOrTx,
  orgId: string,
  transactionId: string,
): Promise<
  {
    invoiceId: string;
    number: string | null;
    clientName: string;
    status: InvoiceStatus;
    amountMinor: bigint;
    currency: string;
  }[]
> {
  return db
    .select({
      invoiceId: invoices.id,
      number: invoices.number,
      clientName: clients.name,
      status: invoices.status,
      amountMinor: invoicePayments.amountMinor,
      currency: invoices.currency,
    })
    .from(invoicePayments)
    .innerJoin(invoices, and(eq(invoices.id, invoicePayments.invoiceId), eq(invoices.orgId, orgId)))
    .innerJoin(clients, and(eq(clients.id, invoices.clientId), eq(clients.orgId, orgId)))
    .where(and(eq(invoicePayments.orgId, orgId), eq(invoicePayments.transactionId, transactionId)))
    .orderBy(asc(invoices.id));
}

export interface IncomingPayment {
  transactionId: string;
  occurredOn: string;
  description: string;
  /** The incoming amount on the bank account. */
  amountMinor: bigint;
  currency: string;
  /** Already allocated to invoices. */
  allocatedMinor: bigint;
  counterparty: string | null;
}

/**
 * Incoming imported bank lines that are not fully allocated to invoices: transactions with
 * source `import`, not reversed, whose bank leg (a posting on a non-system asset account with a
 * currency) is positive. Optionally one currency, on or after `from`, or a single transaction.
 * One statement; the bank leg is the posting the commit booked first.
 */
export async function listIncomingPayments(
  db: DbOrTx,
  orgId: string,
  opts: { currency?: string; from?: string; transactionId?: string; limit?: number } = {},
): Promise<IncomingPayment[]> {
  const result = await db.execute<{
    transaction_id: string;
    occurred_on: string;
    description: string;
    amount: string;
    currency: string;
    allocated: string;
    counterparty: string | null;
  }>(sql`
    select t.id as transaction_id, t.occurred_on::text as occurred_on, t.description,
      leg.amount_minor as amount, leg.currency,
      coalesce((select sum(ip.amount_minor) from invoice_payments ip
        where ip.org_id = ${orgId} and ip.transaction_id = t.id), 0) as allocated,
      (select r.counterparty from import_rows r
        where r.org_id = ${orgId} and r.transaction_id = t.id and r.status = 'new'
        order by r.row_index limit 1) as counterparty
    from transactions t
    join lateral (
      select p.amount_minor, p.currency
      from postings p
      join accounts a on a.id = p.account_id and a.org_id = ${orgId}
      where p.org_id = ${orgId} and p.transaction_id = t.id
        and a.kind = 'asset' and a.system_key is null and a.currency is not null
      order by p.id
      limit 1
    ) leg on true
    where t.org_id = ${orgId}
      and t.source = 'import'
      and leg.amount_minor > 0
      and not exists (select 1 from transactions r where r.org_id = ${orgId} and r.reverses_id = t.id)
      ${opts.currency ? sql`and leg.currency = ${opts.currency}` : sql``}
      ${opts.from ? sql`and t.occurred_on >= ${opts.from}` : sql``}
      ${opts.transactionId ? sql`and t.id = ${opts.transactionId}` : sql``}
    order by t.occurred_on desc, t.id desc
    limit ${opts.limit ?? 500}
  `);
  return result.rows
    .map((r) => ({
      transactionId: r.transaction_id,
      occurredOn: r.occurred_on,
      description: r.description,
      amountMinor: BigInt(r.amount),
      currency: r.currency,
      allocatedMinor: BigInt(r.allocated),
      counterparty: r.counterparty,
    }))
    .filter((p) => p.allocatedMinor < p.amountMinor);
}

export interface OpenInvoice {
  id: string;
  number: string;
  clientName: string;
  currency: string;
  issueDate: string;
  dueDate: string | null;
  totalMinor: bigint;
  paidMinor: bigint;
}

/** Issued (not yet paid) invoices, optionally of the given currencies. */
export async function listOpenInvoices(
  db: DbOrTx,
  orgId: string,
  opts: { currencies?: readonly string[] } = {},
): Promise<OpenInvoice[]> {
  const rows = await db
    .select({
      id: invoices.id,
      number: invoices.number,
      clientName: clients.name,
      currency: invoices.currency,
      issueDate: invoices.issueDate,
      dueDate: invoices.dueDate,
      totalMinor: invoices.totalMinor,
      paidMinor: paidSum(orgId),
    })
    .from(invoices)
    .innerJoin(clients, and(eq(clients.id, invoices.clientId), eq(clients.orgId, orgId)))
    .where(
      and(
        eq(invoices.orgId, orgId),
        eq(invoices.status, 'issued'),
        opts.currencies ? inArray(invoices.currency, [...opts.currencies]) : undefined,
      ),
    )
    .orderBy(asc(invoices.issueDate), asc(invoices.id));
  // Issued invoices always have a number and an issue date (check invoices_dates_when_issued).
  return rows.map((r) => ({ ...r, number: r.number ?? '', issueDate: r.issueDate ?? '' }));
}

export interface InvoiceTotalsRow {
  currency: string;
  outstandingMinor: bigint;
  outstandingCount: number;
  overdueMinor: bigint;
  overdueCount: number;
}

/** What issued invoices still owe per currency, and how much of it is overdue on `today`. */
export async function invoiceTotalsByCurrency(
  db: DbOrTx,
  orgId: string,
  today: string,
): Promise<{ byCurrency: InvoiceTotalsRow[]; draftCount: number }> {
  const result = await db.execute<{
    currency: string;
    outstanding: string;
    outstanding_count: string;
    overdue: string;
    overdue_count: string;
    draft_count: string;
  }>(sql`
    with open as (
      select i.currency, i.status, i.due_date,
        greatest(i.total_minor - coalesce((select sum(ip.amount_minor) from invoice_payments ip
          where ip.org_id = ${orgId} and ip.invoice_id = i.id), 0), 0) as owed
      from invoices i
      where i.org_id = ${orgId} and i.status in ('issued', 'draft')
    )
    select currency,
      coalesce(sum(owed) filter (where status = 'issued'), 0) as outstanding,
      count(*) filter (where status = 'issued') as outstanding_count,
      coalesce(sum(owed) filter (where status = 'issued' and due_date < ${today}), 0) as overdue,
      count(*) filter (where status = 'issued' and due_date < ${today}) as overdue_count,
      count(*) filter (where status = 'draft') as draft_count
    from open
    group by currency
  `);
  let draftCount = 0;
  const byCurrency: InvoiceTotalsRow[] = [];
  for (const r of result.rows) {
    draftCount += Number(r.draft_count);
    if (Number(r.outstanding_count) === 0) continue;
    byCurrency.push({
      currency: r.currency,
      outstandingMinor: BigInt(r.outstanding),
      outstandingCount: Number(r.outstanding_count),
      overdueMinor: BigInt(r.overdue),
      overdueCount: Number(r.overdue_count),
    });
  }
  // Amounts in different currencies are not comparable: by currency code.
  byCurrency.sort((a, b) => a.currency.localeCompare(b.currency));
  return { byCurrency, draftCount };
}
