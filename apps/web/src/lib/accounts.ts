import type { SelectOption } from '@ie-ledger/ui';
import type { Schemas } from './api/client';

type Account = Schemas['Account'];

// Account helpers shared by the accounts page, the transaction form and the rules dialog.

export const ACCOUNT_KIND_LABELS: Record<Account['kind'], string> = {
  asset: 'Assets',
  liability: 'Liabilities',
  equity: 'Equity',
  income: 'Income',
  expense: 'Expenses',
};

/** Order of the groups on the accounts page. */
export const ACCOUNT_KINDS: readonly Account['kind'][] = [
  'asset',
  'liability',
  'equity',
  'income',
  'expense',
];

/** A bank (or cash) account: an asset in one currency that is not a system account. */
export function isBankAccount(a: Account): a is Account & { currency: string } {
  return a.kind === 'asset' && a.currency !== null && a.systemKey === null;
}

export function isActive(a: Account): boolean {
  return a.archivedAt === null;
}

/** What booking against the account means, for option descriptions. */
export function accountRole(a: Account): string {
  if (a.kind === 'income') {
    return a.incomeClass === 'sbs'
      ? 'Small-business income (declared, payment method: bank)'
      : 'Income, not small-business (not declared)';
  }
  if (a.systemKey === 'fx_clearing') return 'Currency exchanges between your accounts';
  if (a.systemKey === 'owner_equity') return "Owner's money in and out";
  if (a.systemKey === 'tax_payable') return 'Small-business tax';
  if (isBankAccount(a)) return `Bank account, ${a.currency}`;
  return a.currency ? `${a.kind}, ${a.currency}` : a.kind;
}

export function accountOptions(
  accounts: readonly Account[],
  filter: (a: Account) => boolean,
): SelectOption[] {
  return accounts
    .filter((a) => isActive(a) && filter(a))
    .map((a) => ({ id: a.id, label: a.name, description: accountRole(a) }));
}
