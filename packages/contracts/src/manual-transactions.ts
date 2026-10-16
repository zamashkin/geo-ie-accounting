import { z } from 'zod';
import { PaymentMethod } from './enums';
import { TransactionPosting } from './ledger';
import { CurrencyCode, IsoDate, MinorUnits, PositiveMinorUnits, Uuid } from './primitives';

// Manual transactions (WS-06): `POST /v1/orgs/:orgId/transactions` takes one of the canonical
// events of packages/domain (income receipt, expense, owner draw or contribution, transfer,
// currency conversion, tax payment). Amounts are positive; the event decides the signs and the
// currency comes from the accounts. `postings` is the advanced mode (owner only): signed
// postings as entered, which must balance per currency.

export const MANUAL_TRANSACTION_TYPES = [
  'income',
  'expense',
  'owner_draw',
  'owner_contribution',
  'transfer',
  'fx_conversion',
  'tax_payment',
  'postings',
] as const;
export const ManualTransactionType = z.enum(MANUAL_TRANSACTION_TYPES).meta({
  id: 'ManualTransactionType',
});
export type ManualTransactionType = z.output<typeof ManualTransactionType>;

const common = {
  occurredOn: IsoDate,
  description: z.string().trim().min(1, 'Enter a description').max(500),
};

export const IncomeReceiptRequest = z
  .object({
    type: z.literal('income'),
    ...common,
    /** Bank account the money arrived in; the amount is in its currency. */
    bankAccountId: Uuid,
    incomeAccountId: Uuid,
    amountMinor: PositiveMinorUnits,
    /** Return line 18–21. Default `bank` (line 20). */
    paymentMethod: PaymentMethod.default('bank'),
  })
  .meta({ id: 'IncomeReceiptRequest' });

export const ExpenseRequest = z
  .object({
    type: z.literal('expense'),
    ...common,
    /** Bank account the money left; the amount is in its currency. */
    bankAccountId: Uuid,
    expenseAccountId: Uuid,
    amountMinor: PositiveMinorUnits,
  })
  .meta({ id: 'ExpenseRequest' });

/** Owner draw (money out to the owner) or contribution (owner's money in), against Owner Equity. */
export const OwnerDrawRequest = z
  .object({
    type: z.literal('owner_draw'),
    ...common,
    bankAccountId: Uuid,
    amountMinor: PositiveMinorUnits,
  })
  .meta({ id: 'OwnerDrawRequest' });

export const OwnerContributionRequest = z
  .object({
    type: z.literal('owner_contribution'),
    ...common,
    bankAccountId: Uuid,
    amountMinor: PositiveMinorUnits,
  })
  .meta({ id: 'OwnerContributionRequest' });

/** Between two own accounts in the same currency. */
export const TransferRequest = z
  .object({
    type: z.literal('transfer'),
    ...common,
    fromAccountId: Uuid,
    toAccountId: Uuid,
    amountMinor: PositiveMinorUnits,
  })
  .meta({ id: 'TransferRequest' });

/** Between two own accounts in different currencies, through FX Clearing. */
export const FxConversionRequest = z
  .object({
    type: z.literal('fx_conversion'),
    ...common,
    fromAccountId: Uuid,
    toAccountId: Uuid,
    /** In the currency of `fromAccountId`. */
    soldAmountMinor: PositiveMinorUnits,
    /** In the currency of `toAccountId`. */
    boughtAmountMinor: PositiveMinorUnits,
  })
  .meta({ id: 'FxConversionRequest' });

/** Paying the small-business tax from a GEL account, against Tax Payable. */
export const TaxPaymentRequest = z
  .object({
    type: z.literal('tax_payment'),
    ...common,
    bankAccountId: Uuid,
    amountMinor: PositiveMinorUnits,
  })
  .meta({ id: 'TaxPaymentRequest' });

export const RawPostingRequest = z
  .object({
    accountId: Uuid,
    /** Signed: positive = debit, negative = credit. Not zero. */
    amountMinor: MinorUnits,
    currency: CurrencyCode,
  })
  .meta({ id: 'RawPostingRequest' });

/** Advanced mode, owner only. */
export const RawPostingsRequest = z
  .object({
    type: z.literal('postings'),
    ...common,
    /** Needed when a posting is on an SBS income account (return lines 18–21). */
    paymentMethod: PaymentMethod.nullable().default(null),
    postings: z.array(RawPostingRequest).min(2).max(50),
  })
  .meta({ id: 'RawPostingsRequest' });

export const CreateTransactionRequest = z
  .discriminatedUnion('type', [
    IncomeReceiptRequest,
    ExpenseRequest,
    OwnerDrawRequest,
    OwnerContributionRequest,
    TransferRequest,
    FxConversionRequest,
    TaxPaymentRequest,
    RawPostingsRequest,
  ])
  .meta({ id: 'CreateTransactionRequest' });
export type CreateTransactionRequest = z.output<typeof CreateTransactionRequest>;
export type CreateTransactionRequestInput = z.input<typeof CreateTransactionRequest>;

/**
 * `POST /transactions/preview`: what `POST /transactions` would book for the same body, with
 * the GEL equivalents and the NBG rates, without booking anything.
 */
export const TransactionPreview = z
  .object({
    occurredOn: IsoDate,
    description: z.string(),
    paymentMethod: PaymentMethod.nullable(),
    postings: z.array(TransactionPosting.omit({ id: true, transactionId: true, orgId: true })),
  })
  .meta({ id: 'TransactionPreview' });
export type TransactionPreview = z.output<typeof TransactionPreview>;
