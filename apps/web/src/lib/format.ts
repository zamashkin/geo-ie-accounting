import { formatAmount, formatMoney, formatPeriodLabel, formatRateBp } from '@ie-ledger/domain';

// The one place web formats money, rates and periods. Amounts arrive from the API as decimal
// strings of minor units (`"569866"` = GEL 5,698.66); they become bigint here and go through
// `packages/domain/format.ts`, which hands Intl an exact decimal string. No JS numbers touch
// an amount. NBG rates are decimal strings too and are shown exactly as the API sends them.

const MINOR = /^-?[0-9]+$/;

/** `"569866"` → `569866n`. Throws on anything that is not an integer string. */
export function parseMinor(amountMinor: string | bigint): bigint {
  if (typeof amountMinor === 'bigint') return amountMinor;
  if (!MINOR.test(amountMinor)) throw new TypeError(`Not a minor-unit amount: ${amountMinor}`);
  return BigInt(amountMinor);
}

export interface FormatMinorOptions {
  /** `code` (default): "GEL 5,698.66"; `none`: "5,698.66". */
  display?: 'code' | 'none';
  /** `exceptZero` adds "+" to positive amounts (deltas, income). */
  signDisplay?: 'auto' | 'exceptZero';
}

/** Formats minor units for display: `formatMinor('569866', 'GEL')` → `"GEL 5,698.66"`. */
export function formatMinor(
  amountMinor: string | bigint,
  currency: string,
  { display = 'code', signDisplay = 'auto' }: FormatMinorOptions = {},
): string {
  const money = { amountMinor: parseMinor(amountMinor), currency };
  if (display === 'none') {
    const text = formatAmount(money, 'en');
    return signDisplay === 'exceptZero' && money.amountMinor > 0n ? `+${text}` : text;
  }
  return formatMoney(money, 'en', { currencyDisplay: 'code', signDisplay });
}

/** Basis points as a percentage: `100` → `"1%"`. */
export function formatBp(bp: number): string {
  return formatRateBp(bp, 'en');
}

const percentFormat = new Intl.NumberFormat('en', { style: 'percent', maximumFractionDigits: 0 });

/** A 0..1 score (not money), e.g. format detection confidence: `0.95` → `"95%"`. */
export function formatScore(score: number): string {
  return percentFormat.format(score);
}

/** `"2025-06"` → `"June 2025"`. */
export function formatPeriod(period: string): string {
  return formatPeriodLabel(period, 'en');
}

const dateFormat = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

/** `"2025-07-15"` → `"15 Jul 2025"`. Calendar dates have no time zone; read them as UTC. */
export function formatIsoDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) return date;
  return dateFormat.format(new Date(Date.UTC(y, m - 1, d)));
}

const timestampFormat = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Asia/Tbilisi',
});

/** ISO timestamp → `"16 Oct 2026, 14:52"` in Tbilisi time. */
export function formatTimestamp(iso: string): string {
  return timestampFormat.format(new Date(iso));
}
