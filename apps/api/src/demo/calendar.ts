// Calendar helpers for the demo seed: business days and month arithmetic on ISO dates.
import {
  addDays,
  firstDayOf,
  nextPeriod,
  periodOf,
  type IsoDate,
  type Period,
} from '@geo-ie-accounting/domain';

/** Monday to Friday (public holidays are ignored: the bank books on them rarely enough). */
export function isWeekday(date: IsoDate): boolean {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day !== 0 && day !== 6;
}

/** `date` if it is a weekday, else the next Monday. */
export function onOrAfterWeekday(date: IsoDate): IsoDate {
  let d = date;
  while (!isWeekday(d)) d = addDays(d, 1);
  return d;
}

/** Last calendar day of the month. */
export function lastDayOf(period: Period): IsoDate {
  return addDays(firstDayOf(nextPeriod(period)), -1);
}

/** The `n`th weekday of the month (1-based). */
export function nthWeekday(period: Period, n: number): IsoDate {
  let d = onOrAfterWeekday(firstDayOf(period));
  for (let i = 1; i < n; i++) d = onOrAfterWeekday(addDays(d, 1));
  return d;
}

/** Last weekday of the month. */
export function lastWeekday(period: Period): IsoDate {
  let d = lastDayOf(period);
  while (!isWeekday(d)) d = addDays(d, -1);
  return d;
}

/** The weekday on or after day `day` of the month, clamped into the month. */
export function weekdayFrom(period: Period, day: number): IsoDate {
  const start = addDays(firstDayOf(period), day - 1);
  const d = onOrAfterWeekday(start);
  return periodOf(d) === period ? d : lastWeekday(period);
}

export function previousPeriod(period: Period): Period {
  return periodOf(addDays(firstDayOf(period), -1));
}

/** Months from `from` to `to`, both included. */
export function periodsBetween(from: Period, to: Period): Period[] {
  const out: Period[] = [];
  for (let p = from; p <= to; p = nextPeriod(p)) out.push(p);
  return out;
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** `2025-03` → `March 2025`. */
export function monthName(period: Period): string {
  return `${MONTHS[Number(period.slice(5, 7)) - 1] ?? period} ${period.slice(0, 4)}`;
}
