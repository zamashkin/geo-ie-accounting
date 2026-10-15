// Date parsing for statements. Dates have no time zone: everything is a calendar date string.

export type DateFormat = 'YYYY-MM-DD' | 'DD.MM.YYYY' | 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'DD.MM.YY';

/** Accepted range: anything outside is almost certainly a mis-parsed column. */
const MIN_YEAR = 1990;
const MAX_YEAR = 2100;

const PATTERNS: Record<DateFormat, { re: RegExp; order: 'ymd' | 'dmy' | 'mdy' }> = {
  'YYYY-MM-DD': { re: /^(\d{4})-(\d{1,2})-(\d{1,2})$/, order: 'ymd' },
  'DD.MM.YYYY': { re: /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/, order: 'dmy' },
  'DD/MM/YYYY': { re: /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, order: 'dmy' },
  'MM/DD/YYYY': { re: /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, order: 'mdy' },
  'DD.MM.YY': { re: /^(\d{1,2})\.(\d{1,2})\.(\d{2})$/, order: 'dmy' },
};

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

/** Builds `YYYY-MM-DD` if the parts form a real calendar date in the accepted range. */
export function isoDate(year: number, month: number, day: number): string | null {
  if (year < MIN_YEAR || year > MAX_YEAR || month < 1 || month > 12 || day < 1) return null;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > daysInMonth) return null;
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

/**
 * Parses a date in the given format. A trailing time (`04.06.2025 00:00:00`, `2025-06-04T00:00`)
 * is ignored. Two-digit years are 20yy (BoG writes `15.06.25`).
 */
export function parseDate(input: string, format: DateFormat): string | null {
  const s = input.trim().split(/[ T]/, 1)[0] ?? '';
  const { re, order } = PATTERNS[format];
  const m = re.exec(s);
  if (!m) return null;
  const a = Number.parseInt(m[1] ?? '', 10);
  const b = Number.parseInt(m[2] ?? '', 10);
  const c = Number.parseInt(m[3] ?? '', 10);
  switch (order) {
    case 'ymd':
      return isoDate(a, b, c);
    case 'dmy':
      return isoDate(format === 'DD.MM.YY' ? 2000 + c : c, b, a);
    case 'mdy':
      return isoDate(c, a, b);
  }
}

const MS_PER_DAY = 86_400_000;
// Day 0 of the 1900 system is 1899-12-31 for serials < 60, but Excel counts a non-existent
// 1900-02-29 as serial 60, so from serial 61 on the effective epoch is 1899-12-30.
const EPOCH_1900 = Date.UTC(1899, 11, 30);
const EPOCH_1904 = Date.UTC(1904, 0, 1);

/**
 * Converts an Excel date serial (the text of a `<v>` element) to `YYYY-MM-DD`. The time-of-day
 * fraction is dropped. Returns null for anything that is not a plausible statement date.
 */
export function excelSerialToIso(serialText: string, date1904 = false): string | null {
  const m = /^(\d{1,6})(?:\.\d+)?$/.exec(serialText.trim());
  if (!m) return null;
  const serial = Number.parseInt(m[1] ?? '', 10);
  if (!date1904 && serial < 61) return null; // before 1900-03-01: never a statement date
  const date = new Date((date1904 ? EPOCH_1904 : EPOCH_1900) + serial * MS_PER_DAY);
  return isoDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}
