// Typed errors thrown by packages/domain. Every error carries a stable snake_case `code` that the
// API can put into the RFC 9457 problem `code` field without parsing messages.

export type DomainErrorCode =
  | 'unsupported_currency'
  | 'currency_mismatch'
  | 'invalid_amount'
  | 'amount_out_of_range'
  | 'invalid_rate'
  | 'missing_rate'
  | 'division_by_zero'
  | 'unbalanced_transaction'
  | 'invalid_transaction'
  | 'invalid_date'
  | 'invalid_period'
  | 'no_rule_set'
  | 'invalid_tax_input'
  | 'invalid_invoice';

export class DomainError extends Error {
  readonly code: DomainErrorCode;

  constructor(code: DomainErrorCode, message: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}

export class UnsupportedCurrencyError extends DomainError {
  constructor(readonly currency: string) {
    super('unsupported_currency', `Unsupported currency '${currency}'`);
  }
}

export class CurrencyMismatchError extends DomainError {
  constructor(
    readonly expected: string,
    readonly actual: string,
  ) {
    super('currency_mismatch', `Currency mismatch: expected ${expected}, got ${actual}`);
  }
}

export class InvalidAmountError extends DomainError {
  constructor(message: string) {
    super('invalid_amount', message);
  }
}

/** The value does not fit Postgres `bigint` (signed 64-bit). */
export class AmountOutOfRangeError extends DomainError {
  constructor(readonly amountMinor: bigint) {
    super('amount_out_of_range', 'Amount does not fit a signed 64-bit integer');
  }
}

export class InvalidRateError extends DomainError {
  constructor(message: string) {
    super('invalid_rate', message);
  }
}

export class MissingRateError extends DomainError {
  constructor(readonly currency: string) {
    super('missing_rate', `An exchange rate is required to convert ${currency} to GEL`);
  }
}

export interface CurrencyImbalance {
  readonly currency: string;
  /** Σ amountMinor of the currency's postings; non-zero. */
  readonly amountMinor: bigint;
}

export class UnbalancedTransactionError extends DomainError {
  constructor(readonly imbalances: readonly CurrencyImbalance[]) {
    super(
      'unbalanced_transaction',
      `Postings do not balance in ${imbalances.map((i) => i.currency).join(', ')}`,
    );
  }
}

export class InvalidTransactionError extends DomainError {
  constructor(message: string) {
    super('invalid_transaction', message);
  }
}

export class InvalidDateError extends DomainError {
  constructor(readonly input: string) {
    super('invalid_date', `Expected a calendar date YYYY-MM-DD, got '${input}'`);
  }
}

export class InvalidPeriodError extends DomainError {
  constructor(readonly input: string) {
    super('invalid_period', `Expected a period YYYY-MM, got '${input}'`);
  }
}

export class NoRuleSetError extends DomainError {
  constructor(readonly date: string) {
    super('no_rule_set', `No tax rule set is in effect on ${date}`);
  }
}

export class InvalidTaxInputError extends DomainError {
  constructor(message: string) {
    super('invalid_tax_input', message);
  }
}

export class InvalidInvoiceError extends DomainError {
  constructor(message: string) {
    super('invalid_invoice', message);
  }
}
