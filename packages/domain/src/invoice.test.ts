import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DomainError } from './errors';
import {
  assertIssuable,
  computeInvoiceTotals,
  formatInvoiceNumber,
  invoiceLineTotal,
  invoiceOutstanding,
  isFullyPaid,
  isInvoiceOverdue,
  parseQuantity,
  resolveIssueDates,
} from './invoice';

describe('invoiceLineTotal', () => {
  it('multiplies a decimal quantity by the unit price in minor units', () => {
    expect(invoiceLineTotal({ quantity: '1', unitPriceMinor: 150000n })).toBe(150000n);
    expect(invoiceLineTotal({ quantity: '2.5', unitPriceMinor: 4000n })).toBe(10000n);
    expect(invoiceLineTotal({ quantity: '0.125', unitPriceMinor: 80000n })).toBe(10000n);
  });

  it('rounds each line half away from zero to the minor unit', () => {
    // 0.333 × 1.00 = 0.333 → 0.33; 1.005 × 1.00 = 1.005 → 1.01 (half up, not half even)
    expect(invoiceLineTotal({ quantity: '0.333', unitPriceMinor: 100n })).toBe(33n);
    expect(invoiceLineTotal({ quantity: '1.005', unitPriceMinor: 100n })).toBe(101n);
    expect(invoiceLineTotal({ quantity: '0.5', unitPriceMinor: 1n })).toBe(1n);
    expect(invoiceLineTotal({ quantity: '0.25', unitPriceMinor: 1n })).toBe(0n);
  });

  it('accepts a zero price but rejects bad quantities and negative prices', () => {
    expect(invoiceLineTotal({ quantity: '3', unitPriceMinor: 0n })).toBe(0n);
    expect(() => parseQuantity('0')).toThrow(DomainError);
    expect(() => parseQuantity('-1')).toThrow(DomainError);
    expect(() => parseQuantity('1.2345')).toThrow(/at most 3/);
    expect(() => parseQuantity('1,5')).toThrow(DomainError);
    expect(() => invoiceLineTotal({ quantity: '1', unitPriceMinor: -1n })).toThrow(/negative/);
  });
});

describe('computeInvoiceTotals', () => {
  it('sums the rounded lines, so the printed lines add up to the printed total', () => {
    const totals = computeInvoiceTotals('USD', [
      { quantity: '0.333', unitPriceMinor: 100n },
      { quantity: '0.333', unitPriceMinor: 100n },
      { quantity: '0.334', unitPriceMinor: 100n },
    ]);
    expect(totals.lineTotalsMinor).toEqual([33n, 33n, 33n]);
    expect(totals.totalMinor).toBe(99n);
  });

  it('is zero without lines and works in zero- and three-decimal currencies', () => {
    expect(computeInvoiceTotals('GEL', []).totalMinor).toBe(0n);
    expect(
      computeInvoiceTotals('JPY', [{ quantity: '1.5', unitPriceMinor: 1001n }]).totalMinor,
    ).toBe(1502n);
    expect(
      computeInvoiceTotals('KWD', [{ quantity: '2', unitPriceMinor: 12345n }]).totalMinor,
    ).toBe(24690n);
  });

  it('rejects an unsupported currency and a total beyond int64', () => {
    expect(() => computeInvoiceTotals('XXX', [])).toThrow(DomainError);
    expect(() =>
      computeInvoiceTotals('USD', [{ quantity: '999999999', unitPriceMinor: 2n ** 62n }]),
    ).toThrow(DomainError);
  });

  it('total = Σ line totals, and every line is within half a minor unit of the exact product', () => {
    const line = fc.record({
      whole: fc.integer({ min: 0, max: 9999 }),
      thousandths: fc.integer({ min: 0, max: 999 }),
      unitPriceMinor: fc.bigInt({ min: 0n, max: 10n ** 9n }),
    });
    fc.assert(
      fc.property(fc.array(line, { maxLength: 20 }), (raw) => {
        const lines = raw
          .filter((l) => l.whole > 0 || l.thousandths > 0)
          .map((l) => ({
            quantity: `${l.whole}.${String(l.thousandths).padStart(3, '0')}`,
            unitPriceMinor: l.unitPriceMinor,
          }));
        const totals = computeInvoiceTotals('GEL', lines);
        expect(totals.totalMinor).toBe(totals.lineTotalsMinor.reduce((a, b) => a + b, 0n));
        lines.forEach((l, i) => {
          const exactTimes1000 = parseQuantity(l.quantity) * l.unitPriceMinor;
          const diff = (totals.lineTotalsMinor[i] ?? 0n) * 1000n - exactTimes1000;
          expect(diff >= -500n && diff <= 500n).toBe(true);
        });
      }),
    );
  });
});

describe('outstanding and paid', () => {
  it('never goes below zero and is paid once the payments cover the total', () => {
    expect(invoiceOutstanding(10000n, 2500n)).toBe(7500n);
    expect(invoiceOutstanding(10000n, 12000n)).toBe(0n);
    expect(isFullyPaid(10000n, 9999n)).toBe(false);
    expect(isFullyPaid(10000n, 10000n)).toBe(true);
    expect(isFullyPaid(0n, 0n)).toBe(false);
  });
});

describe('isInvoiceOverdue', () => {
  it('is overdue only when issued and past the due date', () => {
    const issued = { status: 'issued' as const, dueDate: '2026-10-15' };
    expect(isInvoiceOverdue(issued, '2026-10-15')).toBe(false);
    expect(isInvoiceOverdue(issued, '2026-10-16')).toBe(true);
    expect(isInvoiceOverdue({ ...issued, status: 'paid' }, '2026-11-01')).toBe(false);
    expect(isInvoiceOverdue({ ...issued, status: 'void' }, '2026-11-01')).toBe(false);
    expect(isInvoiceOverdue({ status: 'issued', dueDate: null }, '2030-01-01')).toBe(false);
  });
});

describe('resolveIssueDates', () => {
  it('defaults to today and today + the due days', () => {
    expect(resolveIssueDates({ issueDate: null, dueDate: null }, '2026-12-25', 14)).toEqual({
      issueDate: '2026-12-25',
      dueDate: '2027-01-08',
    });
    expect(resolveIssueDates({ issueDate: '2026-02-20', dueDate: null }, '2026-03-01', 10)).toEqual(
      { issueDate: '2026-02-20', dueDate: '2026-03-02' },
    );
  });

  it('keeps given dates and refuses a due date before the issue date', () => {
    expect(
      resolveIssueDates({ issueDate: '2026-10-01', dueDate: '2026-10-01' }, '2026-10-17'),
    ).toEqual({ issueDate: '2026-10-01', dueDate: '2026-10-01' });
    expect(() =>
      resolveIssueDates({ issueDate: '2026-10-10', dueDate: '2026-10-09' }, '2026-10-17'),
    ).toThrow(/before the issue date/);
  });
});

describe('assertIssuable', () => {
  it('needs a line and a positive total', () => {
    expect(() => assertIssuable('USD', [])).toThrow(/at least one line/);
    expect(() => assertIssuable('USD', [{ quantity: '1', unitPriceMinor: 0n }])).toThrow(
      /above zero/,
    );
    expect(assertIssuable('USD', [{ quantity: '2', unitPriceMinor: 500n }]).totalMinor).toBe(1000n);
  });
});

describe('formatInvoiceNumber', () => {
  it('formats prefix, year and a three-digit sequence', () => {
    expect(formatInvoiceNumber(null, 2026, 1)).toBe('2026-001');
    expect(formatInvoiceNumber('INV-', 2026, 42)).toBe('INV-2026-042');
    expect(formatInvoiceNumber('', 2027, 1234)).toBe('2027-1234');
  });

  it('rejects bad parts', () => {
    expect(() => formatInvoiceNumber(null, 2026, 0)).toThrow(DomainError);
    expect(() => formatInvoiceNumber(null, 99, 1)).toThrow(DomainError);
    expect(() => formatInvoiceNumber('A B', 2026, 1)).toThrow(DomainError);
  });
});
