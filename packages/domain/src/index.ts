// packages/domain: pure business logic (money, FX, ledger, tax rules, dedupe). No I/O.
// Money is always bigint minor units; see ARCHITECTURE §3–4 and ADR 0007 for rounding.

export * from './errors';
export * from './currency';
export * from './rounding';
export * from './money';
export * from './fx';
export * from './date';

/** Sign convention for postings (ARCHITECTURE §4): positive = debit, negative = credit. */
export const POSTING_SIGN = { debit: 1n, credit: -1n } as const;
