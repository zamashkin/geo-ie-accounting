import { CreateTransactionRequest } from '@ie-ledger/contracts';
import type { FieldErrors, Resolver } from 'react-hook-form';
import { set } from 'react-hook-form';
import type { CreateTransactionInput } from '@/lib/api/ledger';
import type { Schemas } from '@/lib/api/client';

// The new-transaction form keeps one flat set of fields for every event type; `toRequest` picks
// the ones the chosen type sends. Validation is the contracts schema on that request, so the
// form and the API agree on what is valid.

export type TransactionType = Schemas['ManualTransactionType'];
type PaymentMethod = NonNullable<Schemas['TransactionView']['paymentMethod']>;

export interface PostingRow {
  accountId: string;
  currency: string;
  /** Signed minor units as typed; null while empty. */
  amountMinor: string | null;
}

export interface TransactionFormValues {
  type: TransactionType;
  occurredOn: string | null;
  description: string;
  bankAccountId: string;
  incomeAccountId: string;
  expenseAccountId: string;
  fromAccountId: string;
  toAccountId: string;
  amountMinor: string | null;
  soldAmountMinor: string | null;
  boughtAmountMinor: string | null;
  paymentMethod: PaymentMethod | null;
  postings: PostingRow[];
}

export const TYPE_LABELS: Record<TransactionType, { label: string; description: string }> = {
  income: { label: 'Income received', description: 'A client paid into a bank account' },
  expense: { label: 'Expense', description: 'The business paid for something' },
  owner_draw: { label: 'Owner draw', description: 'You took money out for yourself' },
  owner_contribution: { label: 'Owner contribution', description: 'You put your own money in' },
  transfer: { label: 'Transfer', description: 'Between two of your accounts, same currency' },
  fx_conversion: { label: 'Currency exchange', description: 'Between two of your accounts' },
  tax_payment: { label: 'Tax payment', description: 'Small-business tax paid from GEL' },
  postings: { label: 'Advanced: postings', description: 'Enter debits and credits yourself' },
};

export function emptyValues(occurredOn: string | null): TransactionFormValues {
  return {
    type: 'income',
    occurredOn,
    description: '',
    bankAccountId: '',
    incomeAccountId: '',
    expenseAccountId: '',
    fromAccountId: '',
    toAccountId: '',
    amountMinor: null,
    soldAmountMinor: null,
    boughtAmountMinor: null,
    paymentMethod: 'bank',
    postings: [
      { accountId: '', currency: 'GEL', amountMinor: null },
      { accountId: '', currency: 'GEL', amountMinor: null },
    ],
  };
}

/** The request for the chosen type. Empty fields become empty strings, which the schema reports. */
export function toRequest(v: TransactionFormValues): CreateTransactionInput {
  const common = { occurredOn: v.occurredOn ?? '', description: v.description };
  const amount = v.amountMinor ?? '';
  switch (v.type) {
    case 'income':
      return {
        type: 'income',
        ...common,
        bankAccountId: v.bankAccountId,
        incomeAccountId: v.incomeAccountId,
        amountMinor: amount,
        paymentMethod: v.paymentMethod ?? 'bank',
      };
    case 'expense':
      return {
        type: 'expense',
        ...common,
        bankAccountId: v.bankAccountId,
        expenseAccountId: v.expenseAccountId,
        amountMinor: amount,
      };
    case 'owner_draw':
    case 'owner_contribution':
    case 'tax_payment':
      return { type: v.type, ...common, bankAccountId: v.bankAccountId, amountMinor: amount };
    case 'transfer':
      return {
        type: 'transfer',
        ...common,
        fromAccountId: v.fromAccountId,
        toAccountId: v.toAccountId,
        amountMinor: amount,
      };
    case 'fx_conversion':
      return {
        type: 'fx_conversion',
        ...common,
        fromAccountId: v.fromAccountId,
        toAccountId: v.toAccountId,
        soldAmountMinor: v.soldAmountMinor ?? '',
        boughtAmountMinor: v.boughtAmountMinor ?? '',
      };
    case 'postings':
      return {
        type: 'postings',
        ...common,
        paymentMethod: v.paymentMethod,
        postings: v.postings.map((p) => ({
          accountId: p.accountId,
          currency: p.currency,
          amountMinor: p.amountMinor ?? '',
        })),
      };
  }
}

function friendly(path: readonly PropertyKey[], message: string): string {
  const field = String(path.at(-1) ?? '');
  if (field.endsWith('AccountId') || field === 'accountId') return 'Choose an account';
  if (field.endsWith('mountMinor')) return 'Enter an amount';
  if (field === 'occurredOn') return 'Choose a date';
  return message;
}

/** react-hook-form resolver: the contracts schema on `toRequest(values)`. */
export const transactionResolver: Resolver<TransactionFormValues> = (values) => {
  const parsed = CreateTransactionRequest.safeParse(toRequest(values));
  if (parsed.success) return { values, errors: {} };
  const errors: FieldErrors<TransactionFormValues> = {};
  for (const issue of parsed.error.issues) {
    const name = issue.path.map(String).join('.');
    set(errors, name, { type: issue.code, message: friendly(issue.path, issue.message) });
  }
  return { values: {}, errors };
};

/** True when the request would pass the schema: the preview is only asked for then. */
export function isComplete(values: TransactionFormValues): boolean {
  return CreateTransactionRequest.safeParse(toRequest(values)).success;
}
