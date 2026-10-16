import { assertIsoDate, firstDayOf, nextPeriod } from '../date';
import type { IsoDate, Period } from '../date';
import type { PaymentMethod } from '../ledger';
import type { IncomeByPaymentMethod, MonthDeclaration } from './declaration';

// Filing status and drift of a monthly return (SPEC §3 M3). Live figures always come from
// `computeDeclarationYear`; a filing is an immutable snapshot of them. Drift = the live figures
// of a filed month no longer match its latest snapshot (a reversal, a late import, a change in
// an earlier month that moves line 15).

/** The figures a filing stores: what the user typed into rs.ge. */
export interface FiledFigures {
  readonly incomeGelMinor: bigint;
  /** Line 15. */
  readonly ytdGelMinor: bigint;
  /** Lines 18–21. */
  readonly byPaymentMethod: IncomeByPaymentMethod;
  readonly rateBp: number;
  readonly taxGelMinor: bigint;
}

/** Return lines compared for drift, in the order the return shows them. */
export const RETURN_LINES = [
  'income',
  'line15',
  'line18',
  'line19',
  'line20',
  'line21',
  'rate',
  'tax',
] as const;
export type ReturnLine = (typeof RETURN_LINES)[number];

/** Lines 18–21 by payment method. */
export const PAYMENT_METHOD_LINES: Readonly<Record<PaymentMethod, ReturnLine>> = {
  cash_register: 'line18',
  pos: 'line19',
  bank: 'line20',
  other: 'line21',
};

export interface LineDifference {
  readonly line: ReturnLine;
  /** GEL minor units, or basis points for `rate`. */
  readonly filed: bigint;
  readonly live: bigint;
  /** live − filed. */
  readonly delta: bigint;
}

function lineValues(f: FiledFigures): Record<ReturnLine, bigint> {
  return {
    income: f.incomeGelMinor,
    line15: f.ytdGelMinor,
    line18: f.byPaymentMethod.cash_register,
    line19: f.byPaymentMethod.pos,
    line20: f.byPaymentMethod.bank,
    line21: f.byPaymentMethod.other,
    rate: BigInt(f.rateBp),
    tax: f.taxGelMinor,
  };
}

/** Every return line whose live value differs from the filed one; empty means no drift. */
export function compareFiledFigures(filed: FiledFigures, live: FiledFigures): LineDifference[] {
  const a = lineValues(filed);
  const b = lineValues(live);
  return RETURN_LINES.filter((line) => a[line] !== b[line]).map((line) => ({
    line,
    filed: a[line],
    live: b[line],
    delta: b[line] - a[line],
  }));
}

/** Transactions that joined or left a month since it was filed. Order follows the inputs. */
export function diffTransactionIds(
  filed: readonly string[],
  live: readonly string[],
): { added: string[]; removed: string[] } {
  const was = new Set(filed);
  const now = new Set(live);
  return {
    added: live.filter((id) => !was.has(id)),
    removed: filed.filter((id) => !now.has(id)),
  };
}

const DAY_MS = 86_400_000;

/** Whole calendar days from `from` to `to` (negative if `to` is earlier). */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  assertIsoDate(from);
  assertIsoDate(to);
  // Both are UTC midnights, so the difference is a whole number of days.
  return (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS;
}

/**
 * - `not_due`: no return for this month (`not_required`), or the month has not ended yet
 *   (`period_open`).
 * - `due`: the month has ended and the deadline is today or later.
 * - `overdue`: past the deadline and never filed.
 * - `filed`: the latest filing matches the live figures.
 * - `filed_with_drift`: the live figures differ from the latest filing.
 */
export type FilingStatus =
  | { readonly kind: 'not_due'; readonly reason: 'not_required' | 'period_open' }
  | { readonly kind: 'due'; readonly daysLeft: number }
  | { readonly kind: 'overdue'; readonly daysOverdue: number }
  | { readonly kind: 'filed' }
  | { readonly kind: 'filed_with_drift'; readonly differences: readonly LineDifference[] };

export type FilingStatusKind = FilingStatus['kind'];

export const FILING_STATUS_KINDS = [
  'not_due',
  'due',
  'overdue',
  'filed',
  'filed_with_drift',
] as const satisfies readonly FilingStatusKind[];

export function figuresOf(month: MonthDeclaration): FiledFigures {
  return {
    incomeGelMinor: month.incomeGelMinor,
    ytdGelMinor: month.ytdGelMinor,
    byPaymentMethod: month.byPaymentMethod,
    rateBp: month.rateBp,
    taxGelMinor: month.taxGelMinor,
  };
}

/** The reporting month is over on `today`, so its return can be filed. */
export function periodEnded(period: Period, today: IsoDate): boolean {
  assertIsoDate(today);
  return today >= firstDayOf(nextPeriod(period));
}

/**
 * Status of one month on `today` (Tbilisi). A filed month stays filed even if the status start
 * date later moves so that no return would be required; its drift is still reported.
 */
export function filingStatus(
  month: MonthDeclaration,
  latestFiling: FiledFigures | null,
  today: IsoDate,
): FilingStatus {
  assertIsoDate(today);
  if (latestFiling) {
    const differences = compareFiledFigures(latestFiling, figuresOf(month));
    return differences.length === 0 ? { kind: 'filed' } : { kind: 'filed_with_drift', differences };
  }
  if (!month.filingRequired) return { kind: 'not_due', reason: 'not_required' };
  if (!periodEnded(month.period, today)) return { kind: 'not_due', reason: 'period_open' };
  const daysLeft = daysBetween(today, month.deadline);
  return daysLeft >= 0 ? { kind: 'due', daysLeft } : { kind: 'overdue', daysOverdue: -daysLeft };
}

/** Why a month cannot be filed on `today`, or null when it can. */
export function filingBlocker(
  month: MonthDeclaration,
  today: IsoDate,
): 'not_required' | 'period_open' | null {
  if (!month.filingRequired) return 'not_required';
  if (!periodEnded(month.period, today)) return 'period_open';
  return null;
}
