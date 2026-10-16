/**
 * Years a year picker offers, newest first: from this year (or `shown`, if later) back to the
 * year of the small-business status start, at least five years back, so older statements fit.
 */
export function yearOptions(
  shown: number,
  sbsEffectiveFrom: string | null,
  thisYear: number = new Date().getFullYear(),
): number[] {
  const newest = Math.max(thisYear, shown);
  const sbsYear = sbsEffectiveFrom ? Number(sbsEffectiveFrom.slice(0, 4)) : newest;
  const oldest = Math.min(shown, sbsYear, thisYear - 5);
  const years: number[] = [];
  for (let y = newest; y >= oldest; y -= 1) years.push(y);
  return years;
}

/** `?year=` as a year the API accepts, or undefined (the API then uses the current year). */
export function parseYearParam(value: string | string[] | undefined): number | undefined {
  if (typeof value !== 'string' || !/^[0-9]{4}$/.test(value)) return undefined;
  const year = Number(value);
  return year >= 2000 ? year : undefined;
}
