import {
  assertIsoDate,
  dayOf,
  firstDayOf,
  formatPeriod,
  nextPeriod,
  periodOf,
  periodsOfYear,
} from '../date';
import type { IsoDate, Period } from '../date';
import { InvalidTaxInputError } from '../errors';
import type { PaymentMethod } from '../ledger';
import { round } from '../rounding';
import type { RoundingMode } from '../rounding';
import { LIMIT_WARNING_THRESHOLDS_BP, latestRuleSet, ruleSetFor, TAX_RULE_SETS } from './rules';
import type { TaxRuleSet } from './rules';

// Monthly SBS declaration figures (SPEC §2.1, §2.4, §3 M3; ARCHITECTURE §4). Pure: the caller
// loads one calendar year of postings on `sbs` income accounts and passes them in.

/** One posting on an `sbs` income account, joined with its transaction's date and method. */
export interface SbsIncomeEntry {
  readonly occurredOn: IsoDate;
  /**
   * `postings.gel_amount_minor` as stored: income is a credit, so it is negative; a reversal of
   * income is positive. SBS income = −Σ gelAmountMinor (ARCHITECTURE §4).
   */
  readonly gelAmountMinor: bigint;
  /** The transaction's payment method (return lines 18–21). Required for counted income. */
  readonly paymentMethod: PaymentMethod | null;
}

export type IncomeByPaymentMethod = Record<PaymentMethod, bigint>;

/**
 * - `inactive`: no SBS status on any day of the month (before the start date, or none set).
 * - `partial`: the status starts during this month; days before the start are excluded.
 * - `active`: the status covers the whole month.
 */
export type SbsMonthStatus = 'inactive' | 'partial' | 'active';

export interface MonthDeclaration {
  readonly period: Period;
  readonly rulesVersion: string;
  readonly sbsStatus: SbsMonthStatus;
  /** A return is due for this month (status active on at least one day). */
  readonly filingRequired: boolean;
  /** SBS income of the month in GEL minor units, net of reversals. Can be negative. */
  readonly incomeGelMinor: bigint;
  /** SBS-account income dated before the status start: not taxed at the SBS rate, flagged. */
  readonly excludedGelMinor: bigint;
  /** Return line 15: cumulative SBS income since 1 January, through the end of this month. */
  readonly ytdGelMinor: bigint;
  /** Return lines 18–21. */
  readonly byPaymentMethod: IncomeByPaymentMethod;
  /** 100 = 1%, 300 = 3%. */
  readonly rateBp: number;
  readonly taxGelMinor: bigint;
  /** This is the month in which cumulative income first went above the annual limit. */
  readonly limitCrossedThisMonth: boolean;
  /** Filing is required and there is no net income: file a zero return. */
  readonly zeroReturn: boolean;
  /** Reversals exceed income this month; the earlier return needs a correction. */
  readonly negativeIncome: boolean;
  readonly deadline: IsoDate;
}

export interface DeclarationYear {
  readonly year: number;
  /** Always 12 months, January first. */
  readonly months: readonly MonthDeclaration[];
  /** Cumulative SBS income at the end of December. */
  readonly totalIncomeGelMinor: bigint;
  readonly totalTaxGelMinor: bigint;
  /** First month whose cumulative income is above the limit; null if the limit was not exceeded. */
  readonly crossingPeriod: Period | null;
  /** The annual limit was exceeded this year (input for next year's `annualLimitStatus`). */
  readonly limitExceeded: boolean;
}

export interface DeclarationInput {
  readonly year: number;
  /** Every posting on an `sbs` income account dated in `year`. */
  readonly entries: readonly SbsIncomeEntry[];
  /** Status start date (may be mid-month). null: no status, nothing is declared. */
  readonly sbsEffectiveFrom: IsoDate | null;
  readonly ruleSets?: readonly TaxRuleSet[];
  readonly roundingMode?: RoundingMode;
}

const BP_SCALE = 10_000n;

const emptyByMethod = (): IncomeByPaymentMethod => ({
  cash_register: 0n,
  pos: 0n,
  bank: 0n,
  other: 0n,
});

/** Tax on one month's income. Rounded once, on the month total (ADR 0007). */
export function taxFor(incomeGelMinor: bigint, rateBp: number, mode?: RoundingMode): bigint {
  if (!Number.isSafeInteger(rateBp) || rateBp < 0) {
    throw new InvalidTaxInputError(`Rate must be non-negative basis points, got ${rateBp}`);
  }
  return round(incomeGelMinor * BigInt(rateBp), BP_SCALE, mode);
}

function statusOf(period: Period, sbsEffectiveFrom: IsoDate | null): SbsMonthStatus {
  if (sbsEffectiveFrom === null || sbsEffectiveFrom >= firstDayOf(nextPeriod(period))) {
    return 'inactive';
  }
  return sbsEffectiveFrom <= firstDayOf(period) ? 'active' : 'partial';
}

/**
 * Declaration figures for every month of `year`.
 *
 * Rate rule (TaxCode Art.90(2)): a month is at the increased rate if cumulative SBS income
 * through the end of that month is above the annual limit, or an earlier month of the year
 * already was. So the whole month of crossing and every later month use 3%, earlier months are
 * untouched, and a later reversal does not bring the 1% back for months after the crossing.
 * A reversal dated in the crossing month (or earlier) can undo the crossing.
 */
export function computeDeclarationYear(input: DeclarationInput): DeclarationYear {
  const { year, entries, sbsEffectiveFrom, roundingMode } = input;
  const ruleSets = input.ruleSets ?? TAX_RULE_SETS;
  if (!Number.isInteger(year) || year < 1 || year > 9999) {
    throw new InvalidTaxInputError(`Invalid year ${year}`);
  }
  if (sbsEffectiveFrom !== null) assertIsoDate(sbsEffectiveFrom);

  const income = new Map<Period, bigint>();
  const excluded = new Map<Period, bigint>();
  const byMethod = new Map<Period, IncomeByPaymentMethod>();
  for (const period of periodsOfYear(year)) byMethod.set(period, emptyByMethod());

  for (const entry of entries) {
    const period = periodOf(entry.occurredOn);
    const methods = byMethod.get(period);
    if (!methods) {
      throw new InvalidTaxInputError(`Entry dated ${entry.occurredOn} is outside ${year}`);
    }
    const amount = -entry.gelAmountMinor;
    if (sbsEffectiveFrom === null || entry.occurredOn < sbsEffectiveFrom) {
      excluded.set(period, (excluded.get(period) ?? 0n) + amount);
      continue;
    }
    if (entry.paymentMethod === null) {
      throw new InvalidTaxInputError(
        `SBS income dated ${entry.occurredOn} has no payment method (return lines 18–21)`,
      );
    }
    income.set(period, (income.get(period) ?? 0n) + amount);
    methods[entry.paymentMethod] += amount;
  }

  const months: MonthDeclaration[] = [];
  let ytd = 0n;
  let totalTax = 0n;
  let crossingPeriod: Period | null = null;
  for (const period of periodsOfYear(year)) {
    const rules = ruleSetFor(firstDayOf(period), ruleSets);
    const sbsStatus = statusOf(period, sbsEffectiveFrom);
    const monthIncome = income.get(period) ?? 0n;
    ytd += monthIncome;

    const crossesNow = crossingPeriod === null && ytd > rules.annualLimitGelMinor.value;
    if (crossesNow) crossingPeriod = period;
    const rateBp = crossingPeriod === null ? rules.baseRateBp.value : rules.increasedRateBp.value;
    const tax = taxFor(monthIncome, rateBp, roundingMode);
    totalTax += tax;
    const filingRequired = sbsStatus !== 'inactive';

    months.push({
      period,
      rulesVersion: rules.version,
      sbsStatus,
      filingRequired,
      incomeGelMinor: monthIncome,
      excludedGelMinor: excluded.get(period) ?? 0n,
      ytdGelMinor: ytd,
      byPaymentMethod: byMethod.get(period) ?? emptyByMethod(),
      rateBp,
      taxGelMinor: tax,
      limitCrossedThisMonth: crossesNow,
      zeroReturn: filingRequired && monthIncome === 0n && rules.zeroReturnsRequired.value,
      negativeIncome: monthIncome < 0n,
      deadline: deadlineFor(period, ruleSets),
    });
  }

  return {
    year,
    months,
    totalIncomeGelMinor: ytd,
    totalTaxGelMinor: totalTax,
    crossingPeriod,
    limitExceeded: crossingPeriod !== null,
  };
}

// ── Limit status, deadlines, status start ──────────────────────────────────────────────────

export const ANNUAL_LIMIT_STATUSES = [
  'ok',
  'warn80',
  'warn95',
  'exceeded',
  'exceeded_second_year',
] as const;
export type AnnualLimitStatus = (typeof ANNUAL_LIMIT_STATUSES)[number];

/**
 * Year-to-date SBS income against the annual limit. `exceeded` means strictly above the limit
 * (exactly GEL 500,000.00 is not exceeded). `exceeded_second_year`: the previous year was also
 * over, so the status is revoked from 1 January (Art.89(2)(a), 89(3)).
 */
export function annualLimitStatus(
  ytdGelMinor: bigint,
  previousYearExceeded: boolean,
  ruleSet: TaxRuleSet = latestRuleSet(),
): AnnualLimitStatus {
  const limit = ruleSet.annualLimitGelMinor.value;
  if (ytdGelMinor > limit) {
    // consecutiveYearsOverLimitForRevocation is 2 in every rule set, so one flag for the
    // previous year is enough. If a rule set ever changes it, this signature has to change.
    return previousYearExceeded ? 'exceeded_second_year' : 'exceeded';
  }
  const scaled = ytdGelMinor * BP_SCALE;
  if (scaled >= limit * BigInt(LIMIT_WARNING_THRESHOLDS_BP.warn95)) return 'warn95';
  if (scaled >= limit * BigInt(LIMIT_WARNING_THRESHOLDS_BP.warn80)) return 'warn80';
  return 'ok';
}

/** Monthly return and payment deadline: the 15th of the month after `period` (Art.93(11)). */
export function deadlineFor(
  period: Period,
  ruleSets: readonly TaxRuleSet[] = TAX_RULE_SETS,
): IsoDate {
  const rules = ruleSetFor(firstDayOf(period), ruleSets);
  return dayOf(nextPeriod(period), rules.filingDeadlineDayOfNextMonth.value);
}

/** Simplified annual return deadline for `year` (1 April of the following year). */
export function annualReturnDeadlineFor(
  year: number,
  ruleSets: readonly TaxRuleSet[] = TAX_RULE_SETS,
): IsoDate {
  const rules = ruleSetFor(firstDayOf(formatPeriod(year, 12)), ruleSets);
  const { month, day } = rules.annualReturnDeadline.value;
  return dayOf(formatPeriod(year + 1, month), day);
}

/**
 * Status start date for an application filed on `applicationDate`: the same day since
 * Order N38/2026, the 1st of the following month before it.
 */
export function sbsStartFromApplication(
  applicationDate: IsoDate,
  ruleSets: readonly TaxRuleSet[] = TAX_RULE_SETS,
): IsoDate {
  const rules = ruleSetFor(applicationDate, ruleSets);
  return rules.statusStart.value === 'application_date'
    ? applicationDate
    : firstDayOf(nextPeriod(periodOf(applicationDate)));
}
