// Read models for declarations and the dashboard. The figures themselves are computed by
// packages/domain (computeDeclarationYear); this only loads its input and aggregates. Every
// query here is one aggregated SQL statement scoped by orgId: no per-month or per-row queries.
import type { PaymentMethod, TransactionSource } from '@ie-ledger/contracts';
import { firstDayOf, nextPeriod, type SbsIncomeEntry } from '@ie-ledger/domain';
import { and, asc, eq, gte, lte, max, sql } from 'drizzle-orm';
import type { DbOrTx } from '../client';
import { accounts, importRows, postings, transactions } from '../schema/index';

const yearBounds = (year: number) => {
  const y = String(year).padStart(4, '0');
  return { from: `${y}-01-01`, to: `${y}-12-31` };
};

/** Last calendar day of `period`. */
const lastDayOf = (period: string) => {
  const next = new Date(`${firstDayOf(nextPeriod(period))}T00:00:00Z`);
  return new Date(next.getTime() - 86_400_000).toISOString().slice(0, 10);
};

/** −Σ gel_amount_minor: SBS income is a credit on the income account (ARCHITECTURE §4). */
const sbsIncome = sql<bigint>`(-coalesce(sum(${postings.gelAmountMinor}), 0))::bigint`.mapWith(
  BigInt,
);

/** Postings on the org's `sbs` income accounts dated `from`..`to` (inclusive). */
const sbsWhere = (orgId: string, from: string, to: string) =>
  and(
    eq(postings.orgId, orgId),
    eq(accounts.incomeClass, 'sbs'),
    gte(transactions.occurredOn, from),
    lte(transactions.occurredOn, to),
  );

/**
 * SBS income per day and payment method in `year`: the input of `computeDeclarationYear`,
 * aggregated in SQL. Reversals are included (they carry the opposite sign), so reversed income
 * nets out. One entry per (date, method) is enough: the domain only splits by date (status
 * start) and method (lines 18–21).
 */
export async function listSbsIncomeEntries(
  db: DbOrTx,
  orgId: string,
  year: number,
): Promise<SbsIncomeEntry[]> {
  const { from, to } = yearBounds(year);
  return db
    .select({
      occurredOn: transactions.occurredOn,
      paymentMethod: transactions.paymentMethod,
      gelAmountMinor: sql<bigint>`sum(${postings.gelAmountMinor})::bigint`.mapWith(BigInt),
    })
    .from(postings)
    .innerJoin(
      transactions,
      and(eq(transactions.id, postings.transactionId), eq(transactions.orgId, orgId)),
    )
    .innerJoin(accounts, and(eq(accounts.id, postings.accountId), eq(accounts.orgId, orgId)))
    .where(sbsWhere(orgId, from, to))
    .groupBy(transactions.occurredOn, transactions.paymentMethod);
}

/**
 * The year of the org's latest posted transaction (any source, reversals included), or null
 * when it has none. The declarations and dashboard open on this year by default.
 */
export async function latestTransactionYear(db: DbOrTx, orgId: string): Promise<number | null> {
  const [row] = await db
    .select({ latest: max(transactions.occurredOn) })
    .from(transactions)
    .where(eq(transactions.orgId, orgId));
  const latest = row?.latest ?? null;
  return latest === null ? null : Number(latest.slice(0, 4));
}

/**
 * The first imported row behind each transaction, for its counterparty. A reversal takes the
 * counterparty of the transaction it reverses. Duplicate rows point at an existing transaction
 * too, so only `new` rows count.
 */
function counterpartyByTransaction(db: DbOrTx, orgId: string) {
  return db
    .selectDistinctOn([importRows.transactionId], {
      transactionId: importRows.transactionId,
      counterparty: importRows.counterparty,
    })
    .from(importRows)
    .where(
      and(
        eq(importRows.orgId, orgId),
        eq(importRows.status, 'new'),
        sql`${importRows.transactionId} is not null`,
      ),
    )
    .orderBy(importRows.transactionId, importRows.rowIndex)
    .as('cp');
}

export interface ContributingTransactionRow {
  id: string;
  occurredOn: string;
  description: string;
  source: TransactionSource;
  paymentMethod: PaymentMethod | null;
  reversesId: string | null;
  incomeGelMinor: bigint;
  amountMinor: bigint;
  currency: string;
  counterparty: string | null;
}

/**
 * Every transaction with a posting on an `sbs` income account dated in `period` (`YYYY-MM`),
 * with the SBS income it adds (in GEL and in the posting currency), oldest first. The caller
 * flags those dated before the status start.
 */
export async function listContributingTransactions(
  db: DbOrTx,
  orgId: string,
  period: string,
): Promise<ContributingTransactionRow[]> {
  const from = firstDayOf(period);
  const to = lastDayOf(period);
  const cp = counterpartyByTransaction(db, orgId);
  return db
    .select({
      id: transactions.id,
      occurredOn: transactions.occurredOn,
      description: transactions.description,
      source: transactions.source,
      paymentMethod: transactions.paymentMethod,
      reversesId: transactions.reversesId,
      incomeGelMinor: sbsIncome,
      amountMinor: sql<bigint>`(-sum(${postings.amountMinor}))::bigint`.mapWith(BigInt),
      currency: sql<string>`min(${postings.currency})`,
      counterparty: sql<string | null>`min(${cp.counterparty})`,
    })
    .from(postings)
    .innerJoin(
      transactions,
      and(eq(transactions.id, postings.transactionId), eq(transactions.orgId, orgId)),
    )
    .innerJoin(accounts, and(eq(accounts.id, postings.accountId), eq(accounts.orgId, orgId)))
    .leftJoin(
      cp,
      sql`${cp.transactionId} = coalesce(${transactions.reversesId}, ${transactions.id})`,
    )
    .where(sbsWhere(orgId, from, to))
    .groupBy(transactions.id)
    .orderBy(asc(transactions.occurredOn), asc(transactions.id));
}

export interface CounterpartyIncomeRow {
  counterparty: string | null;
  incomeGelMinor: bigint;
  transactionCount: number;
}

/**
 * SBS income between `from` and `to` (inclusive) by counterparty: the `top` largest, then the
 * rest summed into one row (`rest`), all in one statement.
 */
export async function sbsIncomeByCounterparty(
  db: DbOrTx,
  orgId: string,
  range: { from: string; to: string },
  top = 5,
): Promise<{
  top: CounterpartyIncomeRow[];
  rest: CounterpartyIncomeRow & { counterpartyCount: number };
}> {
  const result = await db.execute<{
    counterparty: string | null;
    is_top: boolean;
    income: string;
    tx_count: string;
    cp_count: string;
  }>(sql`
    with cp as (
      select distinct on (transaction_id) transaction_id, counterparty
      from ${importRows}
      where org_id = ${orgId} and status = 'new' and transaction_id is not null
      order by transaction_id, row_index
    ),
    per_tx as (
      select t.id, cp.counterparty, -sum(p.gel_amount_minor) as income
      from ${postings} p
      join ${transactions} t on t.id = p.transaction_id and t.org_id = ${orgId}
      join ${accounts} a on a.id = p.account_id and a.org_id = ${orgId}
      left join cp on cp.transaction_id = coalesce(t.reverses_id, t.id)
      where p.org_id = ${orgId} and a.income_class = 'sbs'
        and t.occurred_on between ${range.from} and ${range.to}
      group by t.id, cp.counterparty
    ),
    per_cp as (
      select counterparty, sum(income) as income, count(*) as tx_count
      from per_tx group by counterparty
    ),
    ranked as (
      select *, row_number() over (order by income desc, counterparty nulls last) as rn
      from per_cp
    )
    select case when rn <= ${top} then counterparty end as counterparty,
           rn <= ${top} as is_top,
           sum(income)::bigint::text as income,
           sum(tx_count)::bigint::text as tx_count,
           count(*)::bigint::text as cp_count
    from ranked
    group by 1, 2
    order by is_top desc, sum(income) desc
  `);
  const rows = result.rows.map((r) => ({
    counterparty: r.counterparty,
    isTop: r.is_top,
    incomeGelMinor: BigInt(r.income),
    transactionCount: Number(r.tx_count),
    counterpartyCount: Number(r.cp_count),
  }));
  const rest = rows.find((r) => !r.isTop);
  return {
    top: rows
      .filter((r) => r.isTop)
      .map(({ counterparty, incomeGelMinor, transactionCount }) => ({
        counterparty,
        incomeGelMinor,
        transactionCount,
      })),
    rest: {
      counterparty: null,
      incomeGelMinor: rest?.incomeGelMinor ?? 0n,
      transactionCount: rest?.transactionCount ?? 0,
      counterpartyCount: rest?.counterpartyCount ?? 0,
    },
  };
}

export interface CurrencyIncomeRow {
  currency: string;
  amountMinor: bigint;
  incomeGelMinor: bigint;
  transactionCount: number;
}

/** SBS income between `from` and `to` (inclusive) by original currency, largest first. */
export async function sbsIncomeByCurrency(
  db: DbOrTx,
  orgId: string,
  range: { from: string; to: string },
): Promise<CurrencyIncomeRow[]> {
  return db
    .select({
      currency: postings.currency,
      amountMinor: sql<bigint>`(-sum(${postings.amountMinor}))::bigint`.mapWith(BigInt),
      incomeGelMinor: sbsIncome,
      transactionCount: sql<number>`count(distinct ${transactions.id})::int`,
    })
    .from(postings)
    .innerJoin(
      transactions,
      and(eq(transactions.id, postings.transactionId), eq(transactions.orgId, orgId)),
    )
    .innerJoin(accounts, and(eq(accounts.id, postings.accountId), eq(accounts.orgId, orgId)))
    .where(sbsWhere(orgId, range.from, range.to))
    .groupBy(postings.currency)
    .orderBy(sql`sum(${postings.gelAmountMinor}) asc`, asc(postings.currency));
}
