import { describe, expect, it } from 'vitest';
import { computeDeclarationYear } from './declaration';
import type { MonthDeclaration, SbsIncomeEntry } from './declaration';
import {
  compareFiledFigures,
  daysBetween,
  diffTransactionIds,
  figuresOf,
  filingBlocker,
  filingStatus,
} from './filing';

const income = (occurredOn: string, tetri: bigint): SbsIncomeEntry => ({
  occurredOn,
  gelAmountMinor: -tetri,
  paymentMethod: 'bank',
});

const year = (entries: SbsIncomeEntry[], sbsEffectiveFrom: string | null = '2025-01-01') =>
  computeDeclarationYear({ year: 2025, entries, sbsEffectiveFrom });

const june = (entries: SbsIncomeEntry[]): MonthDeclaration => year(entries).months[5]!;

describe('compareFiledFigures', () => {
  it('reports nothing when the live figures match the filing', () => {
    const m = june([income('2025-06-04', 435_703n)]);
    expect(compareFiledFigures(figuresOf(m), figuresOf(m))).toEqual([]);
  });

  it('reports every changed line after a reversal, with the delta', () => {
    const filed = figuresOf(june([income('2025-06-04', 435_703n), income('2025-06-11', 134_163n)]));
    const live = figuresOf(
      june([
        income('2025-06-04', 435_703n),
        income('2025-06-11', 134_163n),
        { occurredOn: '2025-06-11', gelAmountMinor: 134_163n, paymentMethod: 'bank' },
      ]),
    );
    expect(compareFiledFigures(filed, live)).toEqual([
      { line: 'income', filed: 569_866n, live: 435_703n, delta: -134_163n },
      { line: 'line15', filed: 569_866n, live: 435_703n, delta: -134_163n },
      { line: 'line20', filed: 569_866n, live: 435_703n, delta: -134_163n },
      { line: 'tax', filed: 5_699n, live: 4_357n, delta: -1_342n },
    ]);
  });

  it('catches line 15 drift from a change in an earlier month', () => {
    const filed = figuresOf(june([income('2025-06-04', 100_000n)]));
    const live = figuresOf(june([income('2025-03-01', 50_000n), income('2025-06-04', 100_000n)]));
    expect(compareFiledFigures(filed, live).map((d) => d.line)).toEqual(['line15']);
  });

  it('catches a rate change', () => {
    const filed = figuresOf(june([income('2025-06-04', 100_000n)]));
    const live = figuresOf(
      june([income('2025-06-04', 100_000n), income('2025-05-01', 49_950_001n)]),
    );
    expect(compareFiledFigures(filed, live).find((d) => d.line === 'rate')).toEqual({
      line: 'rate',
      filed: 100n,
      live: 300n,
      delta: 200n,
    });
  });
});

describe('diffTransactionIds', () => {
  it('lists the ids added and removed since filing', () => {
    expect(diffTransactionIds(['a', 'b', 'c'], ['b', 'c', 'd'])).toEqual({
      added: ['d'],
      removed: ['a'],
    });
  });
});

describe('daysBetween', () => {
  it('counts calendar days across months and is negative backwards', () => {
    expect(daysBetween('2025-06-30', '2025-07-15')).toBe(15);
    expect(daysBetween('2025-07-16', '2025-07-15')).toBe(-1);
    expect(daysBetween('2024-02-28', '2024-03-01')).toBe(2);
  });
});

describe('filingStatus', () => {
  const m = june([income('2025-06-04', 100_000n)]);

  it('is not due while the month is open or when no return is required', () => {
    expect(filingStatus(m, null, '2025-06-30')).toEqual({ kind: 'not_due', reason: 'period_open' });
    const inactive = computeDeclarationYear({ year: 2025, entries: [], sbsEffectiveFrom: null })
      .months[5]!;
    expect(filingStatus(inactive, null, '2025-07-01')).toEqual({
      kind: 'not_due',
      reason: 'not_required',
    });
  });

  it('is due with the days left up to and including the deadline, then overdue', () => {
    expect(filingStatus(m, null, '2025-07-01')).toEqual({ kind: 'due', daysLeft: 14 });
    expect(filingStatus(m, null, '2025-07-15')).toEqual({ kind: 'due', daysLeft: 0 });
    expect(filingStatus(m, null, '2025-07-18')).toEqual({ kind: 'overdue', daysOverdue: 3 });
  });

  it('is filed, or filed with drift when the live figures moved', () => {
    expect(filingStatus(m, figuresOf(m), '2025-08-01')).toEqual({ kind: 'filed' });
    const later = june([income('2025-06-04', 100_000n), income('2025-06-20', 1_000n)]);
    const status = filingStatus(later, figuresOf(m), '2025-08-01');
    expect(status.kind).toBe('filed_with_drift');
  });

  it('treats a zero month like any other: due, then filed as a zero return', () => {
    const zero = june([]);
    expect(zero.zeroReturn).toBe(true);
    expect(filingStatus(zero, null, '2025-07-10')).toEqual({ kind: 'due', daysLeft: 5 });
    expect(filingStatus(zero, figuresOf(zero), '2025-07-10')).toEqual({ kind: 'filed' });
  });
});

describe('filingBlocker', () => {
  it('blocks filing an open month or one without a return', () => {
    const m = june([]);
    expect(filingBlocker(m, '2025-06-30')).toBe('period_open');
    expect(filingBlocker(m, '2025-07-01')).toBeNull();
    const inactive = year([], null).months[5]!;
    expect(filingBlocker(inactive, '2025-07-01')).toBe('not_required');
  });
});
