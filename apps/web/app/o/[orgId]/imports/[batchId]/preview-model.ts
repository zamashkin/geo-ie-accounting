import type { SelectOption } from '@ie-ledger/ui';
import type { ApiError } from '@/lib/api/api-error';
import type { Schemas } from '@/lib/api/client';

type Account = Schemas['Account'];
type Row = Schemas['ImportRowView'];

/**
 * The row as the API will return it after `PATCH`, for the optimistic update: an explicit
 * account wins over the suggestion, `null` goes back to the suggestion, `skip` toggles status.
 */
export function applyRowPatch(row: Row, body: Schemas['UpdateImportRowRequestInput']): Row {
  let next = row;
  if (body.accountId !== undefined) {
    next = {
      ...next,
      chosenAccountId: body.accountId,
      accountId: body.accountId ?? next.suggestedAccountId,
    };
  }
  if (body.skip !== undefined) next = { ...next, status: body.skip ? 'skipped' : 'new' };
  return next;
}

/** Rows a commit books: every `new` row. */
export function bookableRows(rows: readonly Row[]): Row[] {
  return rows.filter((r) => r.status === 'new');
}

/** Row ids a 422 from commit names (`errors[].path` = `rows/<id>`). */
export function blockedRowIds(error: ApiError): Set<string> {
  if (error.code !== 'validation_failed') return new Set();
  return new Set(
    (error.problem.errors ?? [])
      .filter((e) => e.path.startsWith('rows/'))
      .map((e) => e.path.slice('rows/'.length)),
  );
}

const KIND_LABEL: Record<Account['kind'], string> = {
  asset: 'Asset',
  liability: 'Liability',
  equity: 'Equity',
  income: 'Income',
  expense: 'Expense',
};

function describe(a: Account): string {
  if (a.kind === 'income') {
    return a.incomeClass === 'sbs'
      ? 'Small-business income (declared)'
      : 'Income, not small-business';
  }
  if (a.systemKey === 'fx_clearing') return 'Currency exchanges between your accounts';
  return a.currency ? `${KIND_LABEL[a.kind]}, ${a.currency}` : KIND_LABEL[a.kind];
}

/**
 * Accounts a row can book against, as the API allows: active, not the statement's own bank
 * account, and in the row's currency unless the account takes any currency.
 */
export function rowAccountOptions(
  accounts: readonly Account[],
  bankAccountId: string,
  currency: string,
): SelectOption[] {
  return accounts
    .filter(
      (a) =>
        a.archivedAt === null &&
        a.id !== bankAccountId &&
        (a.currency === null || a.currency === currency),
    )
    .map((a) => ({ id: a.id, label: a.name, description: describe(a) }));
}
