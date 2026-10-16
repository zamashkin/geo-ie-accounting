import { BASE_CURRENCY } from './currency';
import type { CurrencyCode } from './currency';
import { assertIsoDate } from './date';
import type { IsoDate } from './date';
import {
  CurrencyMismatchError,
  InvalidTransactionError,
  UnbalancedTransactionError,
} from './errors';
import type { CurrencyImbalance } from './errors';
import { toGel } from './fx';
import type { FxRate } from './fx';
import type { Money } from './money';
import type { RoundingMode } from './rounding';

// Double-entry rules (ARCHITECTURE §4). Postings in a transaction sum to zero per currency.
// Sign convention: positive = debit, negative = credit.
//
// The enum-like unions below mirror packages/contracts (domain may not import it, ARCHITECTURE §2).
// Contracts' Posting / TransactionWithPostings are structurally assignable to the input types.

/** Sign convention for postings: positive = debit, negative = credit. */
export const POSTING_SIGN = { debit: 1n, credit: -1n } as const;

export type PaymentMethod = 'cash_register' | 'pos' | 'bank' | 'other';
export type TransactionSource = 'manual' | 'import' | 'invoice_payment' | 'reversal';

/** The minimum a balance check needs. */
export interface PostingAmount {
  readonly amountMinor: bigint;
  readonly currency: CurrencyCode;
}

/** A posting ready to insert (no id / transaction id / org id yet). */
export interface PostingDraft {
  readonly accountId: string;
  /** Signed, in `currency` minor units. */
  readonly amountMinor: bigint;
  readonly currency: CurrencyCode;
  /** Signed GEL equivalent at the posting's rate; equals `amountMinor` for GEL. */
  readonly gelAmountMinor: bigint;
  /** Exchange rate row used; null for GEL. */
  readonly rateId: string | null;
}

/** A transaction ready to insert. */
export interface TransactionDraft {
  readonly occurredOn: IsoDate;
  readonly description: string;
  readonly source: TransactionSource;
  /** Return lines 18–21; set when the transaction posts SBS income. */
  readonly paymentMethod: PaymentMethod | null;
  readonly reversesId: string | null;
  readonly postings: readonly PostingDraft[];
}

/** A rate as used by the builders: the NBG rate plus the id of its `exchange_rates` row. */
export interface RateSnapshot extends FxRate {
  readonly id: string;
}

// ── Balance ────────────────────────────────────────────────────────────────────────────────

/** Non-zero per-currency sums, sorted by currency. Empty when the postings balance. */
export function imbalances(postings: readonly PostingAmount[]): CurrencyImbalance[] {
  const totals = new Map<CurrencyCode, bigint>();
  for (const p of postings) totals.set(p.currency, (totals.get(p.currency) ?? 0n) + p.amountMinor);
  return [...totals]
    .filter(([, amountMinor]) => amountMinor !== 0n)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([currency, amountMinor]) => ({ currency, amountMinor }));
}

/**
 * Throws unless there are at least two postings and they sum to zero in every currency. The DB
 * enforces the same with a deferred trigger; this check gives a typed error before the insert.
 */
export function assertBalanced(postings: readonly PostingAmount[]): void {
  if (postings.length < 2) {
    throw new InvalidTransactionError('A transaction needs at least two postings');
  }
  const off = imbalances(postings);
  if (off.length > 0) throw new UnbalancedTransactionError(off);
}

export function isBalanced(postings: readonly PostingAmount[]): boolean {
  return postings.length >= 2 && imbalances(postings).length === 0;
}

// ── Reversal ───────────────────────────────────────────────────────────────────────────────

export interface ReversibleTransaction {
  readonly id: string;
  readonly occurredOn: IsoDate;
  readonly description: string;
  readonly paymentMethod: PaymentMethod | null;
  readonly postings: readonly PostingDraft[];
}

export interface ReverseOptions {
  /**
   * Date of the reversal. Defaults to the original date, so the correction lands in the same
   * period (a filed period then shows "filed figures differ"). Pass a later date to book the
   * correction in the current period instead.
   */
  readonly occurredOn?: IsoDate;
  readonly description?: string;
}

/**
 * Builds the reversing transaction: every posting negated (amount and GEL equivalent), same
 * accounts and rates, same payment method so the income lines it touched go down. Postings are
 * insert-only, so this is the only way to correct a posted transaction.
 */
export function reverse(
  original: ReversibleTransaction,
  options: ReverseOptions = {},
): TransactionDraft {
  assertBalanced(original.postings);
  const occurredOn = options.occurredOn ?? original.occurredOn;
  assertIsoDate(occurredOn);
  return {
    occurredOn,
    description: options.description ?? `Reversal: ${original.description}`,
    source: 'reversal',
    paymentMethod: original.paymentMethod,
    reversesId: original.id,
    postings: original.postings.map((p) => ({
      accountId: p.accountId,
      amountMinor: -p.amountMinor,
      currency: p.currency,
      gelAmountMinor: -p.gelAmountMinor,
      rateId: p.rateId,
    })),
  };
}

// ── Builders for the canonical events ──────────────────────────────────────────────────────

interface Common {
  readonly occurredOn: IsoDate;
  readonly description: string;
  /** Defaults to `manual`. */
  readonly source?: Exclude<TransactionSource, 'reversal'>;
  readonly roundingMode?: RoundingMode;
}

function assertPositive(amount: Money, what: string): void {
  if (amount.amountMinor <= 0n) {
    throw new InvalidTransactionError(`${what} must be a positive amount`);
  }
}

/** Signed debit/credit pair of postings carrying the same GEL equivalent. */
function leg(
  debitAccountId: string,
  creditAccountId: string,
  amount: Money,
  rate: RateSnapshot | null,
  roundingMode: RoundingMode | undefined,
): [PostingDraft, PostingDraft] {
  // Convert once and negate, so both sides carry exactly the same GEL figure whatever the mode.
  const gel = toGel(amount, rate, roundingMode).amountMinor;
  const rateId = amount.currency === BASE_CURRENCY ? null : (rate?.id ?? null);
  return [
    {
      accountId: debitAccountId,
      amountMinor: amount.amountMinor,
      currency: amount.currency,
      gelAmountMinor: gel,
      rateId,
    },
    {
      accountId: creditAccountId,
      amountMinor: -amount.amountMinor,
      currency: amount.currency,
      gelAmountMinor: -gel,
      rateId,
    },
  ];
}

function finish(draft: TransactionDraft): TransactionDraft {
  assertIsoDate(draft.occurredOn);
  assertBalanced(draft.postings);
  return draft;
}

export interface IncomeReceiptInput extends Common {
  /** Bank (asset) account the money arrived in; debited. */
  readonly bankAccountId: string;
  /** Income account (`sbs` or `non_sbs`); credited. */
  readonly incomeAccountId: string;
  readonly amount: Money;
  /** NBG rate valid on `occurredOn`; null for GEL. */
  readonly rate: RateSnapshot | null;
  /** Return line 18–21. Defaults to `bank` (line 20). */
  readonly paymentMethod?: PaymentMethod;
}

/** Client pays 1,000 USD: `Bank USD +1000 USD`, `Income −1000 USD`. */
export function incomeReceipt(input: IncomeReceiptInput): TransactionDraft {
  assertPositive(input.amount, 'Income');
  return finish({
    occurredOn: input.occurredOn,
    description: input.description,
    source: input.source ?? 'manual',
    paymentMethod: input.paymentMethod ?? 'bank',
    reversesId: null,
    postings: leg(
      input.bankAccountId,
      input.incomeAccountId,
      input.amount,
      input.rate,
      input.roundingMode,
    ),
  });
}

export interface FxConversionInput extends Common {
  /** Account the sold currency leaves; credited. */
  readonly fromAccountId: string;
  /** Account the bought currency arrives in; debited. */
  readonly toAccountId: string;
  /** System `fx_clearing` account. */
  readonly fxClearingAccountId: string;
  readonly sold: Money;
  readonly bought: Money;
  /** NBG rate of the sold currency (null when it is GEL). */
  readonly soldRate: RateSnapshot | null;
  /** NBG rate of the bought currency (null when it is GEL). */
  readonly boughtRate: RateSnapshot | null;
}

/**
 * Bank converts 500 USD → 1,350 GEL, through FX Clearing so each currency balances on its own:
 * `Bank USD −500 USD`, `FX Clearing +500 USD`, `FX Clearing −1350 GEL`, `Bank GEL +1350 GEL`.
 * Each leg carries its GEL equivalent at the NBG rate, never the bank's rate.
 */
export function fxConversion(input: FxConversionInput): TransactionDraft {
  assertPositive(input.sold, 'Sold amount');
  assertPositive(input.bought, 'Bought amount');
  if (input.sold.currency === input.bought.currency) {
    throw new InvalidTransactionError('A conversion needs two different currencies');
  }
  const [clearingIn, fromOut] = leg(
    input.fxClearingAccountId,
    input.fromAccountId,
    input.sold,
    input.soldRate,
    input.roundingMode,
  );
  const [toIn, clearingOut] = leg(
    input.toAccountId,
    input.fxClearingAccountId,
    input.bought,
    input.boughtRate,
    input.roundingMode,
  );
  return finish({
    occurredOn: input.occurredOn,
    description: input.description,
    source: input.source ?? 'manual',
    paymentMethod: null,
    reversesId: null,
    postings: [fromOut, clearingIn, clearingOut, toIn],
  });
}

export interface BankStatementLineInput extends Common {
  /** Bank (asset) account the statement belongs to. */
  readonly bankAccountId: string;
  /** The other side: an income, expense, FX Clearing or any other account. */
  readonly counterAccountId: string;
  /** Signed, as on the statement: positive = money in (bank debited), negative = money out. */
  readonly amount: Money;
  /** NBG rate valid on `occurredOn`; null for GEL. */
  readonly rate: RateSnapshot | null;
  /** Return line 18–21. The ledger requires one when the counter account is SBS income. */
  readonly paymentMethod: PaymentMethod | null;
}

/**
 * One bank statement line booked against one other account, in the statement currency:
 * `Bank +x`, `Counter −x` for money in, the other way round for money out. Both postings carry
 * the same GEL equivalent at the NBG rate. `source` defaults to `import`.
 *
 * A conversion between own accounts books only the leg in the statement's currency, against FX
 * Clearing (`Bank GBP −690.85 GBP`, `FX Clearing +690.85 GBP`). The other account's statement
 * books the other leg, so each currency balances on its own.
 */
export function bankStatementLine(input: BankStatementLineInput): TransactionDraft {
  if (input.amount.amountMinor === 0n) {
    throw new InvalidTransactionError('A statement line needs a non-zero amount');
  }
  if (input.bankAccountId === input.counterAccountId) {
    throw new InvalidTransactionError('A statement line needs two different accounts');
  }
  return finish({
    occurredOn: input.occurredOn,
    description: input.description,
    source: input.source ?? 'import',
    paymentMethod: input.paymentMethod,
    reversesId: null,
    postings: leg(
      input.bankAccountId,
      input.counterAccountId,
      input.amount,
      input.rate,
      input.roundingMode,
    ),
  });
}

export interface TaxPaymentInput extends Common {
  /** System `tax_payable` account; debited. */
  readonly taxPayableAccountId: string;
  /** GEL bank account the tax is paid from; credited. */
  readonly bankAccountId: string;
  /** Tax paid, in GEL. */
  readonly amount: Money;
}

/** Pay the 1% tax: `Tax Payable +x GEL`, `Bank GEL −x GEL`. */
export function taxPayment(input: TaxPaymentInput): TransactionDraft {
  assertPositive(input.amount, 'Tax payment');
  if (input.amount.currency !== BASE_CURRENCY) {
    throw new CurrencyMismatchError(BASE_CURRENCY, input.amount.currency);
  }
  return finish({
    occurredOn: input.occurredOn,
    description: input.description,
    source: input.source ?? 'manual',
    paymentMethod: null,
    reversesId: null,
    postings: leg(
      input.taxPayableAccountId,
      input.bankAccountId,
      input.amount,
      null,
      input.roundingMode,
    ),
  });
}
