import { describe, expect, it } from 'vitest';
import { InvalidTransactionError, MissingRateError, UnbalancedTransactionError } from './errors';
import { parseRate } from './fx';
import {
  expense,
  ownerContribution,
  ownerDraw,
  rawTransaction,
  type RateSnapshot,
  transfer,
} from './ledger';
import { money } from './money';

// Builders for the manual events (WS-06): expense, owner draw/contribution, transfer, raw.

const usd: RateSnapshot = {
  id: 'rate-usd',
  rateScaled: parseRate('2.7'),
  quantity: 1,
  currency: 'USD',
};
const common = { occurredOn: '2026-10-09', description: 'test' };

describe('two-posting events', () => {
  it('expense: debit the expense, credit the bank, same GEL figure', () => {
    const d = expense({
      ...common,
      bankAccountId: 'bank',
      expenseAccountId: 'exp',
      amount: money(5000n, 'USD'),
      rate: usd,
    });
    expect(d.source).toBe('manual');
    expect(d.paymentMethod).toBeNull();
    expect(d.postings).toEqual([
      {
        accountId: 'exp',
        amountMinor: 5000n,
        currency: 'USD',
        gelAmountMinor: 13500n,
        rateId: 'rate-usd',
      },
      {
        accountId: 'bank',
        amountMinor: -5000n,
        currency: 'USD',
        gelAmountMinor: -13500n,
        rateId: 'rate-usd',
      },
    ]);
  });

  it('owner draw takes money out, contribution puts it in', () => {
    const input = {
      ...common,
      bankAccountId: 'bank',
      equityAccountId: 'eq',
      amount: money(100n, 'GEL'),
      rate: null,
    };
    expect(ownerDraw(input).postings.map((p) => [p.accountId, p.amountMinor])).toEqual([
      ['eq', 100n],
      ['bank', -100n],
    ]);
    expect(ownerContribution(input).postings.map((p) => [p.accountId, p.amountMinor])).toEqual([
      ['bank', 100n],
      ['eq', -100n],
    ]);
  });

  it('transfer debits the destination', () => {
    const d = transfer({
      ...common,
      fromAccountId: 'a',
      toAccountId: 'b',
      amount: money(20000n, 'USD'),
      rate: usd,
    });
    expect(d.postings.map((p) => [p.accountId, p.amountMinor, p.gelAmountMinor])).toEqual([
      ['b', 20000n, 54000n],
      ['a', -20000n, -54000n],
    ]);
  });

  it('rejects zero or negative amounts, the same account twice and a missing rate', () => {
    const base = { ...common, fromAccountId: 'a', toAccountId: 'b', rate: null };
    expect(() => transfer({ ...base, amount: money(0n, 'GEL') })).toThrow(InvalidTransactionError);
    expect(() => transfer({ ...base, amount: money(-1n, 'GEL') })).toThrow(InvalidTransactionError);
    expect(() => transfer({ ...base, toAccountId: 'a', amount: money(1n, 'GEL') })).toThrow(
      InvalidTransactionError,
    );
    expect(() => transfer({ ...base, amount: money(1n, 'USD') })).toThrow(MissingRateError);
  });
});

describe('rawTransaction', () => {
  it('converts each posting at its currency rate and keeps the payment method', () => {
    const d = rawTransaction({
      ...common,
      paymentMethod: 'other',
      rates: new Map([['USD', usd]]),
      postings: [
        { accountId: 'bank', amount: money(1000n, 'USD') },
        { accountId: 'inc', amount: money(-700n, 'USD') },
        { accountId: 'inc2', amount: money(-300n, 'USD') },
        { accountId: 'g1', amount: money(55n, 'GEL') },
        { accountId: 'g2', amount: money(-55n, 'GEL') },
      ],
    });
    expect(d.paymentMethod).toBe('other');
    expect(d.postings.map((p) => [p.gelAmountMinor, p.rateId])).toEqual([
      [2700n, 'rate-usd'],
      [-1890n, 'rate-usd'],
      [-810n, 'rate-usd'],
      [55n, null],
      [-55n, null],
    ]);
  });

  it('must balance per currency and have no zero posting', () => {
    const rates = new Map<string, RateSnapshot>();
    expect(() =>
      rawTransaction({
        ...common,
        paymentMethod: null,
        rates,
        postings: [
          { accountId: 'a', amount: money(10n, 'GEL') },
          { accountId: 'b', amount: money(-9n, 'GEL') },
        ],
      }),
    ).toThrow(UnbalancedTransactionError);
    expect(() =>
      rawTransaction({
        ...common,
        paymentMethod: null,
        rates,
        postings: [
          { accountId: 'a', amount: money(0n, 'GEL') },
          { accountId: 'b', amount: money(0n, 'GEL') },
        ],
      }),
    ).toThrow(InvalidTransactionError);
  });
});
