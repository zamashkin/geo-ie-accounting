import { InvalidDateError, InvalidPeriodError } from './errors';

// Calendar dates (`YYYY-MM-DD`) and reporting periods (`YYYY-MM`) as strings, matching the
// contracts. They carry no time zone, so ISO strings compare correctly with `<` / `>`.

/** `YYYY-MM-DD` */
export type IsoDate = string;
/** `YYYY-MM` */
export type Period = string;

const DATE = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/;
const PERIOD = /^([0-9]{4})-(0[1-9]|1[0-2])$/;

function daysInMonth(year: number, month: number): number {
  // Day 0 of the next month is the last day of this one. UTC: no time zone involved.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function isIsoDate(input: string): boolean {
  const match = DATE.exec(input);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

export function assertIsoDate(input: string): asserts input is IsoDate {
  if (!isIsoDate(input)) throw new InvalidDateError(input);
}

export function parsePeriod(period: Period): { year: number; month: number } {
  const match = PERIOD.exec(period);
  if (!match) throw new InvalidPeriodError(period);
  return { year: Number(match[1]), month: Number(match[2]) };
}

export function formatPeriod(year: number, month: number): Period {
  if (!Number.isInteger(year) || year < 1 || year > 9999 || !Number.isInteger(month)) {
    throw new InvalidPeriodError(`${year}-${month}`);
  }
  const period = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
  parsePeriod(period);
  return period;
}

/** Period a date falls in: `2026-09-30` → `2026-09`. */
export function periodOf(date: IsoDate): Period {
  assertIsoDate(date);
  return date.slice(0, 7);
}

export function nextPeriod(period: Period): Period {
  const { year, month } = parsePeriod(period);
  return month === 12 ? formatPeriod(year + 1, 1) : formatPeriod(year, month + 1);
}

/** First calendar day of the period. */
export function firstDayOf(period: Period): IsoDate {
  parsePeriod(period);
  return `${period}-01`;
}

/** The given day of the period's month; throws if the month is shorter. */
export function dayOf(period: Period, day: number): IsoDate {
  const date = `${period}-${String(day).padStart(2, '0')}`;
  assertIsoDate(date);
  return date;
}

/** `2026` → `['2026-01', …, '2026-12']`. */
export function periodsOfYear(year: number): Period[] {
  return Array.from({ length: 12 }, (_, i) => formatPeriod(year, i + 1));
}

const DAY_MS = 86_400_000;

/** `addDays('2026-01-30', 3)` → `'2026-02-02'`. Negative `days` go back. UTC: no time zone. */
export function addDays(date: IsoDate, days: number): IsoDate {
  assertIsoDate(date);
  if (!Number.isInteger(days)) throw new InvalidDateError(`${date} + ${days} days`);
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}
