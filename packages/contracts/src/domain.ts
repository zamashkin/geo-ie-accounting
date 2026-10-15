import { z } from 'zod';
import { IncomeByPaymentMethod } from './entities';
import { IsoDate, MinorUnits, Period } from './primitives';

// Wire shapes for figures computed by packages/domain (WS-01): tax/declaration.ts.
// The enum arrays mirror the domain's unions (domain may not import contracts, ARCHITECTURE §2);
// a package that sees both (db, api) should assert they are equal.
// No `.meta({ id })` yet: registered ids are emitted into apps/api/openapi.json. Add them when a
// route first returns these shapes.

/** Year-to-date SBS income against the GEL 500,000 limit (domain `annualLimitStatus`). */
export const ANNUAL_LIMIT_STATUSES = [
  'ok',
  'warn80',
  'warn95',
  'exceeded',
  'exceeded_second_year',
] as const;
export const AnnualLimitStatus = z.enum(ANNUAL_LIMIT_STATUSES);
export type AnnualLimitStatus = z.output<typeof AnnualLimitStatus>;

/**
 * `inactive`: no SBS status on any day of the month; `partial`: the status starts mid-month
 * (earlier days excluded); `active`: the whole month.
 */
export const SBS_MONTH_STATUSES = ['inactive', 'partial', 'active'] as const;
export const SbsMonthStatus = z.enum(SBS_MONTH_STATUSES);
export type SbsMonthStatus = z.output<typeof SbsMonthStatus>;

/** Live declaration figures for one month (domain `MonthDeclaration`). */
export const DeclarationFigures = z.object({
  period: Period,
  rulesVersion: z.string(),
  sbsStatus: SbsMonthStatus,
  /** A return is due (status active on at least one day of the month). */
  filingRequired: z.boolean(),
  /** SBS income of the month, net of reversals. Can be negative. */
  incomeGelMinor: MinorUnits,
  /** SBS-account income dated before the status start: excluded and flagged. */
  excludedGelMinor: MinorUnits,
  /** Return line 15: cumulative SBS income since 1 January. */
  ytdGelMinor: MinorUnits,
  /** Return lines 18–21. */
  byPaymentMethod: IncomeByPaymentMethod,
  /** 100 = 1%, 300 = 3%. */
  rateBp: z.int().nonnegative(),
  taxGelMinor: MinorUnits,
  /** Cumulative income first went above the annual limit in this month. */
  limitCrossedThisMonth: z.boolean(),
  zeroReturn: z.boolean(),
  /** Reversals exceed income: the earlier return needs a correction. */
  negativeIncome: z.boolean(),
  /** 15th of the following month. */
  deadline: IsoDate,
});
export type DeclarationFigures = z.output<typeof DeclarationFigures>;

/** All twelve months of a year plus the year totals (domain `DeclarationYear`). */
export const DeclarationYearFigures = z.object({
  year: z.int().min(2000).max(9999),
  months: z.array(DeclarationFigures).length(12),
  totalIncomeGelMinor: MinorUnits,
  totalTaxGelMinor: MinorUnits,
  crossingPeriod: Period.nullable(),
  limitExceeded: z.boolean(),
  limitStatus: AnnualLimitStatus,
});
export type DeclarationYearFigures = z.output<typeof DeclarationYearFigures>;
