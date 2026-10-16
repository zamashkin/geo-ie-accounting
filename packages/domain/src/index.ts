// packages/domain: pure business logic (money, FX, ledger, tax rules, dedupe). No I/O.
// Money is always bigint minor units; see ARCHITECTURE §3–4 and ADR 0007 for rounding.

export * from './errors';
export * from './currency';
export * from './rounding';
export * from './money';
export * from './fx';
export * from './date';
export * from './ledger';
export * from './tax/rules';
export * from './tax/declaration';
export * from './tax/filing';
export * from './dedupe';
export * from './categorisation';
export * from './format';
export { sha256Hex, utf8Encode } from './sha256';
