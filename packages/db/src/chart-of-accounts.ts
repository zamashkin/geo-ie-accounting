import type { AccountKind, Bank, IncomeClass, SystemAccountKey } from '@ie-ledger/contracts';
import type { DbOrTx } from './client';
import { accounts } from './schema/index';

export interface AccountTemplate {
  name: string;
  kind: AccountKind;
  currency: string | null;
  systemKey: SystemAccountKey | null;
  incomeClass: IncomeClass | null;
  bank: Bank | null;
}

const bank = (currency: string): AccountTemplate => ({
  name: `Bank ${currency}`,
  kind: 'asset',
  currency,
  systemKey: null,
  incomeClass: null,
  bank: null,
});

/** Chart of accounts every new organisation starts with (SPEC §3 M1). */
export const DEFAULT_CHART_OF_ACCOUNTS: readonly AccountTemplate[] = [
  bank('GEL'),
  bank('USD'),
  bank('EUR'),
  bank('GBP'),
  {
    name: 'FX Clearing',
    kind: 'asset',
    currency: null,
    systemKey: 'fx_clearing',
    incomeClass: null,
    bank: null,
  },
  {
    name: 'Tax Payable',
    kind: 'liability',
    currency: 'GEL',
    systemKey: 'tax_payable',
    incomeClass: null,
    bank: null,
  },
  {
    name: 'Owner Equity',
    kind: 'equity',
    currency: null,
    systemKey: 'owner_equity',
    incomeClass: null,
    bank: null,
  },
  {
    name: 'Income: Services',
    kind: 'income',
    currency: null,
    systemKey: null,
    incomeClass: 'sbs',
    bank: null,
  },
  {
    name: 'Income: Interest',
    kind: 'income',
    currency: null,
    systemKey: null,
    incomeClass: 'non_sbs',
    bank: null,
  },
  {
    name: 'Income: Rental',
    kind: 'income',
    currency: null,
    systemKey: null,
    incomeClass: 'non_sbs',
    bank: null,
  },
  {
    name: 'Expenses: Bank Fees',
    kind: 'expense',
    currency: null,
    systemKey: null,
    incomeClass: null,
    bank: null,
  },
  {
    name: 'Expenses: General',
    kind: 'expense',
    currency: null,
    systemKey: null,
    incomeClass: null,
    bank: null,
  },
];

/** Inserts the default chart of accounts for an org. Call inside the org-creation transaction. */
export async function seedChartOfAccounts(db: DbOrTx, orgId: string) {
  return db
    .insert(accounts)
    .values(DEFAULT_CHART_OF_ACCOUNTS.map((a) => ({ ...a, orgId })))
    .returning();
}
