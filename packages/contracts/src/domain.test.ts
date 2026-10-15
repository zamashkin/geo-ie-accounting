import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AnnualLimitStatus, DeclarationFigures, DeclarationYearFigures } from './index';

const month = (m: number) => ({
  period: `2026-${String(m).padStart(2, '0')}`,
  rulesVersion: '2026-03-01',
  sbsStatus: 'active',
  filingRequired: true,
  incomeGelMinor: '6000000',
  excludedGelMinor: '0',
  ytdGelMinor: '51000000',
  byPaymentMethod: { cash_register: '0', pos: '0', bank: '6000000', other: '0' },
  rateBp: 300,
  taxGelMinor: '180000',
  limitCrossedThisMonth: m === 4,
  zeroReturn: false,
  negativeIncome: false,
  deadline: '2026-05-15',
});

describe('DeclarationFigures', () => {
  it('decodes minor-unit strings to bigint and encodes them back', () => {
    const figures = DeclarationFigures.parse(month(4));
    expect(figures.taxGelMinor).toBe(180000n);
    expect(figures.byPaymentMethod.bank).toBe(6000000n);
    const json = JSON.parse(JSON.stringify(z.encode(DeclarationFigures, figures))) as Record<
      string,
      unknown
    >;
    expect(json.ytdGelMinor).toBe('51000000');
  });

  it('rejects an unknown month status', () => {
    expect(DeclarationFigures.safeParse({ ...month(1), sbsStatus: 'paused' }).success).toBe(false);
  });
});

describe('DeclarationYearFigures', () => {
  it('requires twelve months and a limit status', () => {
    const year = {
      year: 2026,
      months: Array.from({ length: 12 }, (_, i) => month(i + 1)),
      totalIncomeGelMinor: '51000000',
      totalTaxGelMinor: '700000',
      crossingPeriod: '2026-04',
      limitExceeded: true,
      limitStatus: 'exceeded',
    };
    expect(DeclarationYearFigures.parse(year).months).toHaveLength(12);
    expect(
      DeclarationYearFigures.safeParse({ ...year, months: year.months.slice(1) }).success,
    ).toBe(false);
    expect(AnnualLimitStatus.options).toEqual([
      'ok',
      'warn80',
      'warn95',
      'exceeded',
      'exceeded_second_year',
    ]);
  });
});
