import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { InvalidDateError, InvalidTaxInputError, NoRuleSetError } from '../errors';
import type { PaymentMethod } from '../ledger';
import { parseDecimal } from '../money';
import {
  annualLimitStatus,
  annualReturnDeadlineFor,
  computeDeclarationYear,
  deadlineFor,
  sbsStartFromApplication,
  taxFor,
} from './declaration';
import type {
  AnnualLimitStatus,
  DeclarationYear,
  MonthDeclaration,
  SbsIncomeEntry,
} from './declaration';
import { ruleSetFor, TAX_RULE_SETS } from './rules';

/** GEL amount "123.45" → tetri. */
const gel = (amount: string): bigint => parseDecimal(amount, 2);

/** SBS income as stored on the income account: a credit, so negative. */
const income = (
  occurredOn: string,
  amount: string,
  paymentMethod: PaymentMethod = 'bank',
): SbsIncomeEntry => ({
  occurredOn,
  gelAmountMinor: -gel(amount),
  paymentMethod,
});

/** A reversal of income: a debit on the income account. */
const reversal = (
  occurredOn: string,
  amount: string,
  paymentMethod: PaymentMethod = 'bank',
): SbsIncomeEntry => ({
  occurredOn,
  gelAmountMinor: gel(amount),
  paymentMethod,
});

const month = (year: DeclarationYear, m: number): MonthDeclaration => year.months[m - 1]!;
const rates = (year: DeclarationYear) => year.months.map((x) => x.rateBp);

const run = (entries: SbsIncomeEntry[], sbsEffectiveFrom: string | null = '2025-01-01', y = 2026) =>
  computeDeclarationYear({ year: y, entries, sbsEffectiveFrom });

describe('computeDeclarationYear', () => {
  it('computes income, line 15, lines 18–21, rate, tax and deadline per month', () => {
    const year = run([
      income('2026-01-05', '1000.00'),
      income('2026-01-20', '250.00', 'pos'),
      income('2026-01-31', '10.00', 'cash_register'),
      income('2026-01-31', '5.00', 'other'),
      income('2026-02-01', '100.00'),
    ]);
    expect(year.months).toHaveLength(12);
    expect(month(year, 1)).toEqual({
      period: '2026-01',
      rulesVersion: '2024-12-01',
      sbsStatus: 'active',
      filingRequired: true,
      incomeGelMinor: gel('1265.00'),
      excludedGelMinor: 0n,
      ytdGelMinor: gel('1265.00'),
      byPaymentMethod: {
        cash_register: gel('10.00'),
        pos: gel('250.00'),
        bank: gel('1000.00'),
        other: gel('5.00'),
      },
      rateBp: 100,
      taxGelMinor: gel('12.65'),
      limitCrossedThisMonth: false,
      zeroReturn: false,
      negativeIncome: false,
      deadline: '2026-02-15',
    });
    expect(month(year, 2).ytdGelMinor).toBe(gel('1365.00'));
    expect(month(year, 3).ytdGelMinor).toBe(gel('1365.00'));
    expect(month(year, 3).rulesVersion).toBe('2026-03-01');
    expect(year.totalIncomeGelMinor).toBe(gel('1365.00'));
    expect(year.totalTaxGelMinor).toBe(gel('13.65'));
    expect(year.limitExceeded).toBe(false);
    expect(year.crossingPeriod).toBeNull();
  });

  it('crossing the limit mid-month puts the whole month at 3%, earlier months unchanged', () => {
    const year = run([
      income('2026-01-10', '150000.00'),
      income('2026-02-10', '150000.00'),
      income('2026-03-10', '150000.00'),
      income('2026-04-02', '40000.00'), // ytd 490,000
      income('2026-04-20', '20000.00'), // ytd 510,000: crosses on the 20th
      income('2026-05-10', '1000.00'),
    ]);
    expect(rates(year)).toEqual([100, 100, 100, 300, 300, 300, 300, 300, 300, 300, 300, 300]);
    expect(month(year, 1).taxGelMinor).toBe(gel('1500.00'));
    expect(month(year, 3).taxGelMinor).toBe(gel('1500.00'));
    // 3% of the whole April income (60,000), not only of the 10,000 excess.
    expect(month(year, 4).taxGelMinor).toBe(gel('1800.00'));
    expect(month(year, 4).limitCrossedThisMonth).toBe(true);
    expect(month(year, 4).ytdGelMinor).toBe(gel('510000.00'));
    expect(month(year, 5).taxGelMinor).toBe(gel('30.00'));
    expect(month(year, 5).limitCrossedThisMonth).toBe(false);
    expect(year.crossingPeriod).toBe('2026-04');
    expect(year.limitExceeded).toBe(true);
  });

  it('crossing in December only changes December', () => {
    const entries = Array.from({ length: 12 }, (_, i) =>
      income(`2026-${String(i + 1).padStart(2, '0')}-15`, '45000.00'),
    ); // ytd 495,000 at the end of November, 540,000 in December
    const year = run(entries);
    expect(rates(year)).toEqual([...Array<number>(11).fill(100), 300]);
    expect(month(year, 11).ytdGelMinor).toBe(gel('495000.00'));
    expect(month(year, 12).taxGelMinor).toBe(gel('1350.00'));
    expect(year.crossingPeriod).toBe('2026-12');
    expect(month(year, 12).deadline).toBe('2027-01-15');
  });

  it('exactly GEL 500,000.00 is not over the limit', () => {
    const year = run([income('2026-03-01', '499999.99'), income('2026-06-30', '0.01')]);
    expect(month(year, 6).ytdGelMinor).toBe(gel('500000.00'));
    expect(rates(year).every((r) => r === 100)).toBe(true);
    expect(year.limitExceeded).toBe(false);
    expect(annualLimitStatus(year.totalIncomeGelMinor, true)).toBe('warn95');

    const oneTetriMore = run([income('2026-03-01', '499999.99'), income('2026-06-30', '0.02')]);
    expect(oneTetriMore.crossingPeriod).toBe('2026-06');
  });

  it('a reversal dated in the crossing month takes income back under the limit', () => {
    const year = run([
      income('2026-01-10', '300000.00'),
      income('2026-02-10', '250000.00'), // ytd 550,000 → would cross in February
      reversal('2026-02-10', '100000.00'), // corrected in February: ytd 450,000
      income('2026-03-10', '10000.00'),
    ]);
    expect(rates(year).every((r) => r === 100)).toBe(true);
    expect(month(year, 2).incomeGelMinor).toBe(gel('150000.00'));
    expect(month(year, 2).byPaymentMethod.bank).toBe(gel('150000.00'));
    expect(year.crossingPeriod).toBeNull();
  });

  it('a reversal in a later month does not undo 3% for months after the crossing', () => {
    const year = run([
      income('2026-01-10', '300000.00'),
      income('2026-02-10', '250000.00'), // crosses in February
      reversal('2026-03-05', '100000.00'), // ytd back to 450,000 in March
      income('2026-04-10', '1000.00'),
    ]);
    expect(year.crossingPeriod).toBe('2026-02');
    expect(rates(year).slice(0, 4)).toEqual([100, 300, 300, 300]);
    expect(month(year, 3).ytdGelMinor).toBe(gel('450000.00'));
    expect(month(year, 3).incomeGelMinor).toBe(-gel('100000.00'));
    expect(month(year, 3).negativeIncome).toBe(true);
    expect(month(year, 3).taxGelMinor).toBe(-gel('3000.00'));
    expect(month(year, 4).taxGelMinor).toBe(gel('30.00'));
  });

  it('SBS start mid-month: earlier days and months are excluded and flagged', () => {
    const year = run(
      [
        income('2026-02-20', '700.00'),
        income('2026-03-09', '500.00'),
        income('2026-03-10', '1000.00'),
        income('2026-03-31', '200.00', 'pos'),
      ],
      '2026-03-10',
    );
    expect(month(year, 1)).toMatchObject({
      sbsStatus: 'inactive',
      filingRequired: false,
      zeroReturn: false,
      incomeGelMinor: 0n,
      taxGelMinor: 0n,
    });
    expect(month(year, 2)).toMatchObject({
      sbsStatus: 'inactive',
      excludedGelMinor: gel('700.00'),
      incomeGelMinor: 0n,
    });
    expect(month(year, 3)).toMatchObject({
      sbsStatus: 'partial',
      filingRequired: true,
      incomeGelMinor: gel('1200.00'),
      excludedGelMinor: gel('500.00'),
      ytdGelMinor: gel('1200.00'),
      byPaymentMethod: { cash_register: 0n, pos: gel('200.00'), bank: gel('1000.00'), other: 0n },
      taxGelMinor: gel('12.00'),
    });
    expect(month(year, 4).sbsStatus).toBe('active');
  });

  it('SBS start on the 1st makes that month fully active', () => {
    const year = run([], '2026-05-01');
    expect(month(year, 4).sbsStatus).toBe('inactive');
    expect(month(year, 5).sbsStatus).toBe('active');
  });

  it('a zero month still needs a (zero) return', () => {
    const year = run([income('2026-01-10', '100.00'), income('2026-03-10', '100.00')]);
    expect(month(year, 2)).toMatchObject({
      filingRequired: true,
      zeroReturn: true,
      incomeGelMinor: 0n,
      taxGelMinor: 0n,
      ytdGelMinor: gel('100.00'),
      deadline: '2026-03-15',
    });
    expect(month(year, 1).zeroReturn).toBe(false);
  });

  it('income fully reversed within the month is a zero return', () => {
    const year = run([income('2026-01-10', '100.00'), reversal('2026-01-12', '100.00')]);
    expect(month(year, 1)).toMatchObject({ zeroReturn: true, negativeIncome: false });
  });

  it('without SBS status nothing is declared', () => {
    const year = run([income('2026-01-10', '100.00')], null);
    expect(year.months.every((m) => !m.filingRequired && m.sbsStatus === 'inactive')).toBe(true);
    expect(month(year, 1).excludedGelMinor).toBe(gel('100.00'));
    expect(year.totalIncomeGelMinor).toBe(0n);
  });

  it('a status starting after the year leaves every month inactive', () => {
    const year = run([], '2027-02-01');
    expect(year.months.every((m) => m.sbsStatus === 'inactive')).toBe(true);
  });

  it('rounds the tax once per month, half-even by default', () => {
    // 0.50 GEL at 1% = 0.005 → 0.00; 1.50 GEL → 0.015 → 0.02.
    expect(month(run([income('2026-01-10', '0.50')]), 1).taxGelMinor).toBe(0n);
    expect(month(run([income('2026-01-10', '1.50')]), 1).taxGelMinor).toBe(2n);
    const halfUp = computeDeclarationYear({
      year: 2026,
      entries: [income('2026-01-10', '0.50')],
      sbsEffectiveFrom: '2025-01-01',
      roundingMode: 'half_up',
    });
    expect(month(halfUp, 1).taxGelMinor).toBe(1n);
    // Per month total, not per entry: 3 × 0.50 = 1.50 → 0.02 (per entry would give 0.00).
    expect(
      month(
        run([
          income('2026-01-01', '0.50'),
          income('2026-01-02', '0.50'),
          income('2026-01-03', '0.50'),
        ]),
        1,
      ).taxGelMinor,
    ).toBe(2n);
  });

  it('uses the rule set of each month (custom table with a limit change)', () => {
    const base = ruleSetFor('2026-03-01');
    const ruleSets = [
      ...TAX_RULE_SETS,
      {
        ...base,
        version: '2026-07-01',
        effectiveFrom: '2026-07-01',
        annualLimitGelMinor: {
          value: gel('100.00'),
          source: 'test',
          confidence: 'secondary' as const,
        },
      },
    ];
    const year = computeDeclarationYear({
      year: 2026,
      entries: [income('2026-01-10', '150.00')],
      sbsEffectiveFrom: '2025-01-01',
      ruleSets,
    });
    // Over the (test) limit from July, when the lower limit takes effect.
    expect(year.crossingPeriod).toBe('2026-07');
    expect(month(year, 7).rulesVersion).toBe('2026-07-01');
  });

  it('rejects bad input with typed errors', () => {
    expect(() => run([income('2025-12-31', '1.00')])).toThrow(InvalidTaxInputError);
    expect(() =>
      run([{ occurredOn: '2026-01-10', gelAmountMinor: -1n, paymentMethod: null }]),
    ).toThrow(/payment method/);
    expect(() => run([income('2026-02-30', '1.00')])).toThrow(InvalidDateError);
    expect(() => run([], '2026-13-01')).toThrow(InvalidDateError);
    expect(() => run([], '2025-01-01', 2026.5)).toThrow(InvalidTaxInputError);
    expect(() => run([], '2020-01-01', 2023)).toThrow(NoRuleSetError);
  });

  it('accepts a missing payment method on income before the status start', () => {
    const year = run(
      [{ occurredOn: '2026-01-10', gelAmountMinor: -100n, paymentMethod: null }],
      '2026-02-01',
    );
    expect(month(year, 1).excludedGelMinor).toBe(100n);
  });

  it('property: line 15 is the running sum and lines 18–21 add up to the month income', () => {
    const entryArb = fc.record({
      month: fc.integer({ min: 1, max: 12 }),
      day: fc.integer({ min: 1, max: 28 }),
      gelAmountMinor: fc.bigInt({ min: -(10n ** 7n), max: 10n ** 10n }),
      paymentMethod: fc.constantFrom<PaymentMethod>('cash_register', 'pos', 'bank', 'other'),
    });
    fc.assert(
      fc.property(fc.array(entryArb, { maxLength: 40 }), (raw) => {
        const entries = raw.map((e) => ({
          occurredOn: `2026-${String(e.month).padStart(2, '0')}-${String(e.day).padStart(2, '0')}`,
          gelAmountMinor: -e.gelAmountMinor,
          paymentMethod: e.paymentMethod,
        }));
        const year = run(entries);
        let ytd = 0n;
        let crossed = false;
        for (const m of year.months) {
          const lines = m.byPaymentMethod;
          expect(lines.cash_register + lines.pos + lines.bank + lines.other).toBe(m.incomeGelMinor);
          ytd += m.incomeGelMinor;
          expect(m.ytdGelMinor).toBe(ytd);
          // Once at 3%, never back to 1% within the year.
          if (crossed) expect(m.rateBp).toBe(300);
          crossed ||= m.rateBp === 300;
        }
      }),
    );
  });
});

describe('taxFor', () => {
  it('applies basis points with rounding', () => {
    expect(taxFor(gel('1000.00'), 100)).toBe(gel('10.00'));
    expect(taxFor(gel('1000.00'), 300)).toBe(gel('30.00'));
    expect(taxFor(-gel('1000.00'), 300)).toBe(-gel('30.00'));
    expect(() => taxFor(1n, -1)).toThrow(InvalidTaxInputError);
    expect(() => taxFor(1n, 1.5)).toThrow(InvalidTaxInputError);
  });
});

describe('annualLimitStatus', () => {
  const TABLE: [string, boolean, AnnualLimitStatus][] = [
    ['0.00', false, 'ok'],
    ['399999.99', false, 'ok'],
    ['400000.00', false, 'warn80'],
    ['474999.99', false, 'warn80'],
    ['475000.00', false, 'warn95'],
    ['500000.00', false, 'warn95'],
    ['500000.01', false, 'exceeded'],
    ['500000.01', true, 'exceeded_second_year'],
    ['900000.00', true, 'exceeded_second_year'],
    ['100.00', true, 'ok'],
    ['480000.00', true, 'warn95'],
  ];
  it.each(TABLE)('%s GEL, previous year exceeded: %s → %s', (ytd, prev, expected) => {
    expect(annualLimitStatus(gel(ytd), prev)).toBe(expected);
  });

  it('uses the limit of the rule set it is given', () => {
    const set = {
      ...ruleSetFor('2026-10-15'),
      annualLimitGelMinor: { value: gel('1000.00'), source: 't', confidence: 'secondary' as const },
    };
    expect(annualLimitStatus(gel('800.00'), false, set)).toBe('warn80');
    expect(annualLimitStatus(gel('1000.01'), false, set)).toBe('exceeded');
  });
});

describe('deadlines and status start', () => {
  it.each([
    ['2026-09', '2026-10-15'],
    ['2026-12', '2027-01-15'],
    ['2026-01', '2026-02-15'],
    ['2024-12', '2025-01-15'],
  ])('return for %s is due %s', (period, due) => {
    expect(deadlineFor(period)).toBe(due);
  });

  it('annual return is due 1 April of the next year', () => {
    expect(annualReturnDeadlineFor(2026)).toBe('2027-04-01');
  });

  it.each([
    ['2026-02-14', '2026-03-01'], // before Order N38: 1st of the next month
    ['2025-12-20', '2026-01-01'],
    ['2026-03-01', '2026-03-01'], // from March 2026: the application date itself
    ['2026-03-17', '2026-03-17'],
  ])('application on %s starts the status on %s', (applied, start) => {
    expect(sbsStartFromApplication(applied)).toBe(start);
  });
});
