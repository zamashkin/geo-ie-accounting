import { assertIsoDate } from '../date';
import type { IsoDate } from '../date';
import { NoRuleSetError } from '../errors';

// Small business status (SBS) tax rules as dated config (SPEC §2). This file is the only place
// the 1% / 3% rates, the GEL 500,000 limit and the 15th-of-the-month deadline are written down.
//
// Verified 2026-10-15 against the consolidated Tax Code (matsne.gov.ge doc 1043717, version
// 30/09/2026). `primary` = the legal text itself; `secondary` = professional or advisory sources
// that need an accountant's sign-off before release (SPEC Q3).
//
// A new rule set is added when any value changes. Each set is complete (later sets spread the
// earlier one and override), so a period is always computed with exactly one set: the latest
// whose `effectiveFrom` is on or before the period's first day.

export type Confidence = 'primary' | 'secondary';

/** A rule value with where it comes from. */
export interface Sourced<T> {
  readonly value: T;
  /** Citation, e.g. `'TaxCode Art.90(2)'`. */
  readonly source: string;
  readonly confidence: Confidence;
  readonly note?: string;
}

/** How the status start date follows from the application date. */
export type StatusStartRule = 'first_of_next_month' | 'application_date';

/** Which monthly return layout applies. */
export type ReturnLayout = 'before_2024_12' | 'lines_15_18_21';

export interface TaxRuleSet {
  /** Stored as `declarations.rules_version`. Equals `effectiveFrom`. */
  readonly version: string;
  readonly effectiveFrom: IsoDate;
  /** Basis points of taxable income: 100 = 1%. */
  readonly baseRateBp: Sourced<number>;
  /** From the month the annual limit is crossed through December: 300 = 3%. */
  readonly increasedRateBp: Sourced<number>;
  /** Gross SBS income per calendar year, GEL minor units. Exceeded means strictly above. */
  readonly annualLimitGelMinor: Sourced<bigint>;
  /** The increased rate covers the whole month of crossing and every later month that year. */
  readonly increasedRateFrom: Sourced<'month_of_crossing'>;
  /** Status is revoked from 1 January after this many consecutive years over the limit. */
  readonly consecutiveYearsOverLimitForRevocation: Sourced<number>;
  /** Monthly return and payment due on `dayOfMonth` of the month after the period. */
  readonly filingDeadlineDayOfNextMonth: Sourced<number>;
  /** Simplified annual return due on this day of the following year. */
  readonly annualReturnDeadline: Sourced<{ readonly month: number; readonly day: number }>;
  readonly statusStart: Sourced<StatusStartRule>;
  /** A return is due every month while the status is active, income or not. */
  readonly zeroReturnsRequired: Sourced<boolean>;
  readonly lossesCarriedForward: Sourced<boolean>;
  readonly recordsRetentionYears: Sourced<number>;
  readonly returnLayout: Sourced<ReturnLayout>;
  /** VAT registration threshold; the dashboard only shows a notice. */
  readonly vatRegistrationThresholdGelMinor: Sourced<bigint>;
}

const RULES_2024_01_01: TaxRuleSet = {
  version: '2024-01-01',
  effectiveFrom: '2024-01-01',
  baseRateBp: { value: 100, source: 'TaxCode Art.90(1)', confidence: 'primary' },
  increasedRateBp: { value: 300, source: 'TaxCode Art.90(2)', confidence: 'primary' },
  annualLimitGelMinor: {
    value: 50_000_000n,
    source: 'TaxCode Art.88(3), Art.89(2)(a), Art.90(2)',
    confidence: 'primary',
    note: 'GEL 700,000 for wine and agro tourism operators: out of scope for v1.',
  },
  increasedRateFrom: {
    value: 'month_of_crossing',
    source: 'TaxCode Art.90(2)',
    confidence: 'primary',
    note: 'Whole month of crossing, not only the excess. Earlier months are not recalculated.',
  },
  consecutiveYearsOverLimitForRevocation: {
    value: 2,
    source: 'TaxCode Art.89(2)(a), Art.89(3)',
    confidence: 'primary',
  },
  filingDeadlineDayOfNextMonth: { value: 15, source: 'TaxCode Art.93(11)', confidence: 'primary' },
  annualReturnDeadline: {
    value: { month: 4, day: 1 },
    source: 'Simplified annual income return',
    confidence: 'secondary',
  },
  statusStart: {
    value: 'first_of_next_month',
    source: 'Minister of Finance Order N999 (before Order N38/2026)',
    confidence: 'secondary',
  },
  zeroReturnsRequired: { value: true, source: 'Order N38/2026', confidence: 'secondary' },
  lossesCarriedForward: { value: false, source: 'TaxCode Art.91(5)', confidence: 'primary' },
  recordsRetentionYears: {
    value: 6,
    source: 'TaxCode Art.91(1); Order N999 (before Order N38/2026)',
    confidence: 'secondary',
  },
  returnLayout: {
    value: 'before_2024_12',
    source: 'Order N999 Appendix 5 (before Order N390)',
    confidence: 'secondary',
  },
  vatRegistrationThresholdGelMinor: {
    value: 10_000_000n,
    source: 'VAT registration threshold (SPEC §2.4)',
    confidence: 'secondary',
  },
};

/** Return lines 15 and 18–21 from the December 2024 period on. */
const RULES_2024_12_01: TaxRuleSet = {
  ...RULES_2024_01_01,
  version: '2024-12-01',
  effectiveFrom: '2024-12-01',
  returnLayout: {
    value: 'lines_15_18_21',
    source: 'Order N390 amending Order N999, Appendix 5',
    confidence: 'secondary',
  },
};

/** Order N38/2026 (published 06.02.2026): status from the application date; records 3 years. */
const RULES_2026_03_01: TaxRuleSet = {
  ...RULES_2024_12_01,
  version: '2026-03-01',
  effectiveFrom: '2026-03-01',
  statusStart: {
    value: 'application_date',
    source: 'Order N38/2026 amending Order N999',
    confidence: 'secondary',
  },
  recordsRetentionYears: {
    value: 3,
    source: 'TaxCode Art.91(1); Order N38/2026',
    confidence: 'secondary',
  },
};

/**
 * All rule sets, oldest first. Periods before the first `effectiveFrom` are not supported: the
 * Articles 88–90 wording used here is the one after Law No 3922 of 13.12.2023.
 */
export const TAX_RULE_SETS: readonly TaxRuleSet[] = [
  RULES_2024_01_01,
  RULES_2024_12_01,
  RULES_2026_03_01,
];

/** Rule set in effect on `date`: the latest with `effectiveFrom <= date`. */
export function ruleSetFor(
  date: IsoDate,
  ruleSets: readonly TaxRuleSet[] = TAX_RULE_SETS,
): TaxRuleSet {
  assertIsoDate(date);
  let found: TaxRuleSet | undefined;
  for (const set of ruleSets) {
    if (set.effectiveFrom <= date && (!found || set.effectiveFrom > found.effectiveFrom)) {
      found = set;
    }
  }
  if (!found) throw new NoRuleSetError(date);
  return found;
}

/** The newest rule set, for "now" views that have no period (e.g. limit warnings). */
export function latestRuleSet(ruleSets: readonly TaxRuleSet[] = TAX_RULE_SETS): TaxRuleSet {
  const latest = ruleSets.reduce<TaxRuleSet | undefined>(
    (acc, set) => (!acc || set.effectiveFrom > acc.effectiveFrom ? set : acc),
    undefined,
  );
  if (!latest) throw new NoRuleSetError('(no rule sets)');
  return latest;
}

/**
 * Product thresholds for the year-to-date limit warnings (SPEC §3 M3), in basis points of the
 * annual limit. A product choice, not law, so they are not part of a rule set.
 */
export const LIMIT_WARNING_THRESHOLDS_BP = { warn80: 8000, warn95: 9500 } as const;
