# WS-01 Domain core

**Phase 1.** Pure TypeScript, no I/O.

## Owns
`packages/domain/**`

## Deliver
- `currency.ts`: supported currencies with minor-unit exponent.
- `money.ts`: create/add/negate/compare/sum with currency checks; parse/serialise decimal strings ↔ `bigint` minor units. Throws typed errors on currency mismatch.
- `fx.ts`: `toGel(money, rate: { rateScaled: bigint; quantity: number })` per ARCHITECTURE §3; single `round` function with configurable mode (default half-even until ADR decides).
- `ledger.ts`: `assertBalanced(postings)` per currency; `reverse(transaction)` builder; helpers to build the canonical events in ARCHITECTURE §4 (income receipt, FX conversion, tax payment).
- `tax/rules.ts`: versioned rule sets with `effectiveFrom`, built from SPEC §2. Each value records its `source` (e.g. `'TaxCode Art.90(2)'`) and `confidence: 'primary' | 'secondary'`.
- `tax/declaration.ts`: given a year of SBS income postings, `sbsEffectiveFrom` and the rule set, compute per month: income, cumulative income since 1 Jan (line 15), split by payment method (lines 18–21), rate (1% or 3% per the month-of-crossing rule in SPEC §2.1), tax. Also `annualLimitStatus(ytd, previousYearExceeded)` returning `ok | warn80 | warn95 | exceeded | exceeded_second_year`, and `deadlineFor(period)` (15th of the next month).
- Required test cases: crossing the limit mid-month (whole month at 3%, earlier months unchanged); crossing in December; exactly GEL 500,000.00 (not exceeded); a reversal that takes income back under the limit; SBS start mid-month; a zero month.
- `dedupe.ts`: hash per ARCHITECTURE §6 with normalisation (trim, collapse whitespace, lowercase, strip punctuation in references).
- `format.ts`: display formatting via `Intl.NumberFormat` (en, ka, ru).

## Acceptance
- ≥ 95% line coverage.
- fast-check property tests: reversal of any balanced transaction is balanced and nets to zero; `toGel` of a sum vs sum of `toGel` differs by at most n−1 minor units for n items.
- Table-driven tests for tax rules across an `effectiveFrom` boundary.
