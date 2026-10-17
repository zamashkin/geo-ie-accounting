import { IsoDate } from '@geo-ie-accounting/contracts';

// Calendar helpers for NBG dates. Dates are `YYYY-MM-DD` strings with no time zone; arithmetic is
// done on UTC midnights so it never crosses a daylight-saving boundary.

const DAY_MS = 86_400_000;

function toUtcMs(date: string): number {
  if (!IsoDate.safeParse(date).success) {
    throw new RangeError(`Expected a YYYY-MM-DD date, got '${date}'`);
  }
  return Date.parse(`${date}T00:00:00Z`);
}

export function addDays(date: string, days: number): string {
  return new Date(toUtcMs(date) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return (toUtcMs(to) - toUtcMs(from)) / DAY_MS;
}

/** Every date from `from` to `to`, both included. Empty when `from` is after `to`. */
export function eachDay(from: string, to: string): string[] {
  const n = daysBetween(from, to);
  return Array.from({ length: Math.max(0, n + 1) }, (_, i) => addDays(from, i));
}

/** NBG works in Tbilisi time: UTC+4, no daylight saving since 2005. */
export const NBG_TIME_ZONE = 'Asia/Tbilisi';
export const NBG_UTC_OFFSET = '+04:00';

const tbilisiDateFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: NBG_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** The calendar date in Tbilisi at `instant`. */
export function tbilisiDate(instant: Date): string {
  return tbilisiDateFormat.format(instant);
}
