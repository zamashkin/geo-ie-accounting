# 0007 Rounding of GEL equivalents and tax (pending SPEC Q6)

Status: proposed (WS-01, 2026-10-16). Waiting on an accountant's answer to SPEC Q6.

## Decision
All rounding in the app goes through `round(numerator, denominator, mode)` in `packages/domain/src/rounding.ts`. It does exact bigint arithmetic and supports `half_even`, `half_up` (ties away from zero), `half_down`, `up`, `down`, `ceiling` and `floor`. `DEFAULT_ROUNDING_MODE` is `half_even` for now.

Until Q6 is answered, the domain rounds like this:

- The GEL equivalent is rounded per posting, to the tetri, when the posting is built (`toGel`). The value is stored in `postings.gel_amount_minor` and nothing converts it again later. In a two-sided entry the domain converts the amount once and negates the result, so the debit and the credit carry the same GEL figure in every mode.
- Tax is rounded once per month, on that month's SBS income total, to the tetri (`taxFor`). It is not rounded per transaction.
- Nothing is rounded to whole lari yet. `roundToStep(amount, 100n, mode)` exists for the case where Q6 says the return wants whole lari.

Half-even is the default because over many postings its errors cancel out instead of drifting in one direction. Half-up is what most people expect, and it may be what rs.ge does. A property test checks that converting a sum and summing the conversions differ by at most n−1 tetri for n items, in every mode.

## Alternatives
- Round the tax per transaction. This gives a different total from the return, which is computed on the month figure.
- Convert the month total to GEL instead of each posting. This does not fit Art. 73(10), which uses the rate of each transaction day, and the figures shown in the ledger would no longer add up to the declared total.
- Keep a separate rounding helper in each module. Changing the policy would then mean finding every copy.

## Consequences
Changing the mode means changing one constant, or passing `roundingMode` to `toGel`, the ledger builders and `computeDeclarationYear`. Postings already stored keep their GEL figures, because they are insert-only. If Q6 picks a different mode for the GEL equivalent, it only applies to new postings, unless we decide to correct old ones with reversals. Filed declarations hold snapshots and never change. When Q6 is answered, this ADR becomes accepted or superseded, and the tests that pin `half_even` (`rounding.test.ts`, `fx.test.ts`, `declaration.test.ts`) get updated to match.
