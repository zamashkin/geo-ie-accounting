import { describe, expect, it } from 'vitest';
import { InvalidPeriodError, UnsupportedCurrencyError } from './errors';
import { formatAmount, formatMoney, formatPeriodLabel, formatRateBp, LOCALES } from './format';
import { INT64_MAX, money } from './money';

// ICU output uses non-breaking and narrow no-break spaces as group separators; normalise them so
// the expectations stay readable.
const plain = (s: string) => s.replace(/[\u00a0\u202f]/g, ' ');

describe('formatMoney', () => {
  it.each([
    ['en', 'GEL', '-₾1,234,567.89'],
    ['en', 'USD', '-$1,234,567.89'],
    ['ka', 'GEL', '-1 234 567,89 ₾'],
    ['ka', 'EUR', '-1 234 567,89 €'],
    ['ru', 'GBP', '-1 234 567,89 £'],
    ['ru', 'USD', '-1 234 567,89 $'],
  ] as const)('%s %s', (locale, currency, expected) => {
    expect(plain(formatMoney(money(-123_456_789n, currency), locale))).toBe(expected);
  });

  it('defaults to English and the narrow symbol', () => {
    expect(formatMoney(money(100_050n, 'USD'))).toBe('$1,000.50');
  });

  it('supports currency codes and an explicit plus sign', () => {
    expect(plain(formatMoney(money(100_050n, 'GEL'), 'en', { currencyDisplay: 'code' }))).toBe(
      'GEL 1,000.50',
    );
    expect(formatMoney(money(100_050n, 'GEL'), 'en', { signDisplay: 'exceptZero' })).toBe(
      '+₾1,000.50',
    );
  });

  it('respects the minor-unit exponent', () => {
    expect(formatMoney(money(1_000n, 'JPY'), 'en')).toBe('¥1,000');
    expect(plain(formatMoney(money(1_234n, 'KWD'), 'en', { currencyDisplay: 'code' }))).toBe(
      'KWD 1.234',
    );
  });

  it('prints amounts beyond 2^53 exactly (no float conversion)', () => {
    expect(formatMoney(money(INT64_MAX, 'GEL'), 'en')).toBe('₾92,233,720,368,547,758.07');
    expect(formatMoney(money(9_007_199_254_740_993n, 'USD'), 'en')).toBe('$90,071,992,547,409.93');
  });

  it('works in every supported locale', () => {
    for (const locale of LOCALES) {
      expect(formatMoney(money(1n, 'GEL'), locale)).toMatch(/0[.,]01/);
    }
  });

  it('rejects unsupported currencies', () => {
    expect(() => formatMoney({ amountMinor: 1n, currency: 'XYZ' })).toThrow(
      UnsupportedCurrencyError,
    );
  });
});

describe('formatAmount', () => {
  it('formats without a currency sign', () => {
    expect(formatAmount(money(123_456n, 'USD'))).toBe('1,234.56');
    expect(plain(formatAmount(money(-123_456_789n, 'GEL'), 'ru'))).toBe('-1 234 567,89');
    expect(formatAmount(money(5n, 'JPY'))).toBe('5');
  });
});

describe('formatRateBp', () => {
  it.each([
    [100, 'en', '1%'],
    [300, 'en', '3%'],
    [250, 'ka', '2,5%'],
    [250, 'ru', '2,5 %'],
  ] as const)('%i bp in %s → %s', (bp, locale, expected) => {
    expect(plain(formatRateBp(bp, locale))).toBe(expected);
  });

  it('defaults to English', () => {
    expect(formatRateBp(100)).toBe('1%');
  });
});

describe('formatPeriodLabel', () => {
  it('names the month in each locale', () => {
    expect(formatPeriodLabel('2026-09')).toBe('September 2026');
    expect(formatPeriodLabel('2026-09', 'ka')).toBe('სექტემბერი, 2026');
    expect(formatPeriodLabel('2026-09', 'ru')).toBe('сентябрь 2026 г.');
    expect(() => formatPeriodLabel('2026-9')).toThrow(InvalidPeriodError);
  });
});
