// packages/domain: pure business logic (money, FX, ledger, tax rules, dedupe). No I/O.
// WS-01 fills this package; see docs/tasks/WS-01-domain.md.

/** Sign convention for postings (ARCHITECTURE §4): positive = debit, negative = credit. */
export const POSTING_SIGN = { debit: 1n, credit: -1n } as const;
