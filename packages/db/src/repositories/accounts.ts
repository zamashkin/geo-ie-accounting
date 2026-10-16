import type { Bank, SystemAccountKey } from '@ie-ledger/contracts';
import { and, asc, eq, isNull, notExists, sql } from 'drizzle-orm';
import type { DbOrTx, Tx } from '../client';
import { accounts, postings } from '../schema/index';

export type AccountRow = typeof accounts.$inferSelect;

/** Accounts of an org, oldest first. Archived accounts only when asked for. */
export async function listAccounts(
  db: DbOrTx,
  orgId: string,
  opts: { includeArchived?: boolean } = {},
): Promise<AccountRow[]> {
  return db
    .select()
    .from(accounts)
    .where(
      and(
        eq(accounts.orgId, orgId),
        opts.includeArchived ? undefined : isNull(accounts.archivedAt),
      ),
    )
    .orderBy(asc(accounts.createdAt), asc(accounts.id));
}

export async function getAccount(
  db: DbOrTx,
  orgId: string,
  accountId: string,
): Promise<AccountRow | null> {
  const [row] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.orgId, orgId), eq(accounts.id, accountId)));
  return row ?? null;
}

export async function getSystemAccount(
  db: DbOrTx,
  orgId: string,
  key: SystemAccountKey,
): Promise<AccountRow | null> {
  const [row] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.orgId, orgId), eq(accounts.systemKey, key)));
  return row ?? null;
}

/** The oldest active `sbs` income account (`Income: Services` in the default chart). */
export async function getDefaultSbsIncomeAccount(
  db: DbOrTx,
  orgId: string,
): Promise<AccountRow | null> {
  const [row] = await db
    .select()
    .from(accounts)
    .where(
      and(
        eq(accounts.orgId, orgId),
        eq(accounts.kind, 'income'),
        eq(accounts.incomeClass, 'sbs'),
        isNull(accounts.archivedAt),
      ),
    )
    .orderBy(asc(accounts.createdAt), asc(accounts.id))
    .limit(1);
  return row ?? null;
}

/** Locks one account of the org until the transaction ends (rename / archive). */
export async function lockAccount(
  tx: Tx,
  orgId: string,
  accountId: string,
): Promise<AccountRow | null> {
  const [row] = await tx
    .select()
    .from(accounts)
    .where(and(eq(accounts.orgId, orgId), eq(accounts.id, accountId)))
    .for('update');
  return row ?? null;
}

export type NewAccount = Pick<
  typeof accounts.$inferInsert,
  'name' | 'kind' | 'currency' | 'incomeClass' | 'bank' | 'iban'
>;

/** A user-created account (never a system account). */
export async function createAccount(
  tx: Tx,
  orgId: string,
  values: NewAccount,
): Promise<AccountRow> {
  const [row] = await tx
    .insert(accounts)
    .values({ ...values, orgId, systemKey: null })
    .returning();
  if (!row) throw new Error('account insert returned no row');
  return row;
}

/** Name and archive flag are the only things that change on an account. */
export async function updateAccount(
  tx: Tx,
  orgId: string,
  accountId: string,
  patch: { name?: string; archivedAt?: Date | null },
): Promise<AccountRow> {
  const [row] = await tx
    .update(accounts)
    .set(patch)
    .where(and(eq(accounts.orgId, orgId), eq(accounts.id, accountId)))
    .returning();
  if (!row) throw new Error('account update returned no row');
  return row;
}

export interface AccountCurrencySum {
  accountId: string;
  currency: string;
  /** Σ amount_minor, debit-positive. */
  amountMinor: bigint;
}

/**
 * Σ of the postings per account and currency, debit-positive, zero sums left out. Reversals are
 * postings too, so a reversed line nets out. `accountId` narrows it to one account.
 */
export async function accountBalances(
  db: DbOrTx,
  orgId: string,
  opts: { accountId?: string } = {},
): Promise<AccountCurrencySum[]> {
  const total = sql<string>`sum(${postings.amountMinor})`;
  const rows = await db
    .select({ accountId: postings.accountId, currency: postings.currency, total })
    .from(postings)
    .where(
      and(
        eq(postings.orgId, orgId),
        opts.accountId ? eq(postings.accountId, opts.accountId) : undefined,
      ),
    )
    .groupBy(postings.accountId, postings.currency)
    .having(sql`${total} <> 0`)
    .orderBy(postings.accountId, postings.currency);
  // numeric sum comes back as a decimal string; it is an integer by construction.
  return rows.map((r) => ({
    accountId: r.accountId,
    currency: r.currency,
    amountMinor: BigInt(r.total),
  }));
}

export interface BankAccountKey {
  /** IBAN without the currency suffix BoG prints after it. */
  iban: string;
  currency: string;
}

export interface MatchedBankAccount {
  account: AccountRow;
  /** How the account was found: matched on IBAN + currency, an unused default one, or new. */
  outcome: 'matched' | 'claimed' | 'created';
  /** The row before a claim, for the audit log. */
  before: AccountRow | null;
}

const BANK_NAMES: Record<Bank, string> = {
  bog: 'Bank of Georgia',
  tbc: 'TBC Bank',
  other: 'Bank',
};

/**
 * Finds the bank account a statement belongs to, by IBAN **and** currency: BoG uses one IBAN
 * for all of a client's currency accounts.
 *
 * Without a match, an unused bank account of that currency from the default chart (no IBAN, no
 * bank, no postings, e.g. `Bank GBP`) is claimed: it gets the IBAN and bank. Otherwise a new
 * asset account is created. Takes the request transaction; the unique index
 * `accounts_org_iban_currency_uq` stops two concurrent imports creating the account twice.
 */
export async function matchOrCreateBankAccount(
  tx: Tx,
  orgId: string,
  key: BankAccountKey,
  bank: Bank,
): Promise<MatchedBankAccount> {
  const [existing] = await tx
    .select()
    .from(accounts)
    .where(
      and(
        eq(accounts.orgId, orgId),
        eq(accounts.iban, key.iban),
        eq(accounts.currency, key.currency),
      ),
    );
  if (existing) return { account: existing, outcome: 'matched', before: null };

  const name = `${BANK_NAMES[bank]} ${key.currency}`;
  const [unused] = await tx
    .select()
    .from(accounts)
    .where(
      and(
        eq(accounts.orgId, orgId),
        eq(accounts.kind, 'asset'),
        eq(accounts.currency, key.currency),
        isNull(accounts.iban),
        isNull(accounts.bank),
        isNull(accounts.systemKey),
        isNull(accounts.archivedAt),
        notExists(
          tx
            .select({ one: sql`1` })
            .from(postings)
            .where(and(eq(postings.orgId, orgId), eq(postings.accountId, accounts.id))),
        ),
      ),
    )
    .orderBy(asc(accounts.createdAt), asc(accounts.id))
    .limit(1)
    .for('update');
  if (unused) {
    const [claimed] = await tx
      .update(accounts)
      .set({ iban: key.iban, bank, name })
      .where(and(eq(accounts.orgId, orgId), eq(accounts.id, unused.id)))
      .returning();
    if (!claimed) throw new Error('account claim returned no row');
    return { account: claimed, outcome: 'claimed', before: unused };
  }

  const [created] = await tx
    .insert(accounts)
    .values({
      orgId,
      name,
      kind: 'asset',
      currency: key.currency,
      bank,
      iban: key.iban,
    })
    .returning();
  if (!created) throw new Error('account insert returned no row');
  return { account: created, outcome: 'created', before: null };
}
