import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  CurrencyMismatchError,
  InvalidDateError,
  InvalidTransactionError,
  MissingRateError,
  UnbalancedTransactionError,
} from './errors';
import { parseRate } from './fx';
import {
  assertBalanced,
  fxConversion,
  imbalances,
  incomeReceipt,
  isBalanced,
  POSTING_SIGN,
  reverse,
  taxPayment,
} from './ledger';
import type { PostingDraft, RateSnapshot } from './ledger';
import { money } from './money';

const ACC = {
  bankUsd: 'acc-bank-usd',
  bankGel: 'acc-bank-gel',
  income: 'acc-income-sbs',
  fx: 'acc-fx-clearing',
  tax: 'acc-tax-payable',
};
const usdRate: RateSnapshot = {
  id: 'rate-usd-2026-10-09',
  rateScaled: parseRate('2.7'),
  quantity: 1,
  currency: 'USD',
};

const p = (accountId: string, amountMinor: bigint, currency = 'GEL'): PostingDraft => ({
  accountId,
  amountMinor,
  currency,
  gelAmountMinor: amountMinor,
  rateId: null,
});

describe('balance', () => {
  it('uses positive = debit, negative = credit', () => {
    expect(POSTING_SIGN.debit + POSTING_SIGN.credit).toBe(0n);
  });

  it('accepts postings that sum to zero per currency', () => {
    const postings = [p('a', 100n, 'USD'), p('b', -100n, 'USD'), p('c', -5n), p('d', 5n)];
    expect(() => {
      assertBalanced(postings);
    }).not.toThrow();
    expect(isBalanced(postings)).toBe(true);
  });

  it('does not net one currency against another', () => {
    const postings = [p('a', 100n, 'USD'), p('b', -100n, 'GEL')];
    expect(imbalances(postings)).toEqual([
      { currency: 'GEL', amountMinor: -100n },
      { currency: 'USD', amountMinor: 100n },
    ]);
    expect(() => {
      assertBalanced(postings);
    }).toThrow(UnbalancedTransactionError);
    expect(isBalanced(postings)).toBe(false);
  });

  it('reports every unbalanced currency in a typed error', () => {
    try {
      assertBalanced([p('a', 1n, 'USD'), p('b', 2n, 'EUR'), p('c', -1n, 'USD')]);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(UnbalancedTransactionError);
      expect((error as UnbalancedTransactionError).code).toBe('unbalanced_transaction');
      expect((error as UnbalancedTransactionError).imbalances).toEqual([
        { currency: 'EUR', amountMinor: 2n },
      ]);
    }
  });

  it('needs at least two postings', () => {
    expect(() => {
      assertBalanced([p('a', 0n)]);
    }).toThrow(InvalidTransactionError);
    expect(isBalanced([])).toBe(false);
  });
});

describe('incomeReceipt', () => {
  it('debits the bank and credits income with the same GEL equivalent', () => {
    const tx = incomeReceipt({
      occurredOn: '2026-10-10',
      description: 'Invoice 12',
      bankAccountId: ACC.bankUsd,
      incomeAccountId: ACC.income,
      amount: money(100_000n, 'USD'),
      rate: usdRate,
    });
    expect(tx).toEqual({
      occurredOn: '2026-10-10',
      description: 'Invoice 12',
      source: 'manual',
      paymentMethod: 'bank',
      reversesId: null,
      postings: [
        {
          accountId: ACC.bankUsd,
          amountMinor: 100_000n,
          currency: 'USD',
          gelAmountMinor: 270_000n,
          rateId: usdRate.id,
        },
        {
          accountId: ACC.income,
          amountMinor: -100_000n,
          currency: 'USD',
          gelAmountMinor: -270_000n,
          rateId: usdRate.id,
        },
      ],
    });
  });

  it('keeps both GEL figures equal even with an asymmetric rounding mode', () => {
    // 0.05 USD × 2.7 = 13.5 tetri; floor would give 13 and −14 if each side were converted.
    const tx = incomeReceipt({
      occurredOn: '2026-10-10',
      description: 'tiny',
      bankAccountId: ACC.bankUsd,
      incomeAccountId: ACC.income,
      amount: money(5n, 'USD'),
      rate: usdRate,
      roundingMode: 'floor',
    });
    expect(tx.postings.map((x) => x.gelAmountMinor)).toEqual([13n, -13n]);
  });

  it('books GEL income with no rate and honours source and payment method', () => {
    const tx = incomeReceipt({
      occurredOn: '2026-10-10',
      description: 'POS sale',
      bankAccountId: ACC.bankGel,
      incomeAccountId: ACC.income,
      amount: money(5_000n, 'GEL'),
      rate: null,
      paymentMethod: 'pos',
      source: 'import',
    });
    expect(tx.paymentMethod).toBe('pos');
    expect(tx.source).toBe('import');
    expect(tx.postings.every((x) => x.rateId === null && x.gelAmountMinor === x.amountMinor)).toBe(
      true,
    );
  });

  it('rejects non-positive amounts, a missing rate and bad dates', () => {
    const base = {
      occurredOn: '2026-10-10',
      description: 'x',
      bankAccountId: ACC.bankUsd,
      incomeAccountId: ACC.income,
      rate: usdRate,
    };
    expect(() => incomeReceipt({ ...base, amount: money(0n, 'USD') })).toThrow(
      InvalidTransactionError,
    );
    expect(() => incomeReceipt({ ...base, amount: money(1n, 'USD'), rate: null })).toThrow(
      MissingRateError,
    );
    expect(() =>
      incomeReceipt({ ...base, amount: money(1n, 'USD'), occurredOn: '2026-02-30' }),
    ).toThrow(InvalidDateError);
  });
});

describe('fxConversion', () => {
  it('routes 500 USD → 1,350 GEL through FX Clearing (ARCHITECTURE §4)', () => {
    const tx = fxConversion({
      occurredOn: '2026-10-10',
      description: 'Conversion',
      fromAccountId: ACC.bankUsd,
      toAccountId: ACC.bankGel,
      fxClearingAccountId: ACC.fx,
      sold: money(50_000n, 'USD'),
      bought: money(135_000n, 'GEL'),
      soldRate: usdRate,
      boughtRate: null,
    });
    expect(tx.paymentMethod).toBeNull();
    expect(tx.postings).toEqual([
      {
        accountId: ACC.bankUsd,
        amountMinor: -50_000n,
        currency: 'USD',
        gelAmountMinor: -135_000n,
        rateId: usdRate.id,
      },
      {
        accountId: ACC.fx,
        amountMinor: 50_000n,
        currency: 'USD',
        gelAmountMinor: 135_000n,
        rateId: usdRate.id,
      },
      {
        accountId: ACC.fx,
        amountMinor: -135_000n,
        currency: 'GEL',
        gelAmountMinor: -135_000n,
        rateId: null,
      },
      {
        accountId: ACC.bankGel,
        amountMinor: 135_000n,
        currency: 'GEL',
        gelAmountMinor: 135_000n,
        rateId: null,
      },
    ]);
  });

  it('converts both legs at their own NBG rate between two foreign currencies', () => {
    const gbp: RateSnapshot = { id: 'rate-gbp', rateScaled: parseRate('3.6924'), quantity: 1 };
    const tx = fxConversion({
      occurredOn: '2025-06-05',
      description: 'GBP → USD',
      fromAccountId: 'acc-gbp',
      toAccountId: ACC.bankUsd,
      fxClearingAccountId: ACC.fx,
      sold: money(69_085n, 'GBP'),
      bought: money(90_000n, 'USD'),
      soldRate: gbp,
      boughtRate: usdRate,
    });
    expect(tx.postings.map((x) => [x.currency, x.gelAmountMinor])).toEqual([
      ['GBP', -255_089n],
      ['GBP', 255_089n],
      ['USD', -243_000n],
      ['USD', 243_000n],
    ]);
  });

  it('rejects same-currency and non-positive conversions', () => {
    const base = {
      occurredOn: '2026-10-10',
      description: 'x',
      fromAccountId: ACC.bankUsd,
      toAccountId: ACC.bankGel,
      fxClearingAccountId: ACC.fx,
      soldRate: usdRate,
      boughtRate: usdRate,
    };
    expect(() =>
      fxConversion({ ...base, sold: money(1n, 'USD'), bought: money(1n, 'USD') }),
    ).toThrow(InvalidTransactionError);
    expect(() =>
      fxConversion({ ...base, sold: money(-1n, 'USD'), bought: money(1n, 'GEL') }),
    ).toThrow(InvalidTransactionError);
    expect(() =>
      fxConversion({ ...base, sold: money(1n, 'USD'), bought: money(0n, 'GEL') }),
    ).toThrow(InvalidTransactionError);
  });
});

describe('taxPayment', () => {
  it('debits Tax Payable and credits the GEL bank account', () => {
    const tx = taxPayment({
      occurredOn: '2026-10-15',
      description: 'SBS tax 2026-09',
      taxPayableAccountId: ACC.tax,
      bankAccountId: ACC.bankGel,
      amount: money(2_712n, 'GEL'),
    });
    expect(tx.postings).toEqual([
      {
        accountId: ACC.tax,
        amountMinor: 2_712n,
        currency: 'GEL',
        gelAmountMinor: 2_712n,
        rateId: null,
      },
      {
        accountId: ACC.bankGel,
        amountMinor: -2_712n,
        currency: 'GEL',
        gelAmountMinor: -2_712n,
        rateId: null,
      },
    ]);
    expect(tx.paymentMethod).toBeNull();
  });

  it('only accepts positive GEL', () => {
    const base = {
      occurredOn: '2026-10-15',
      description: 'x',
      taxPayableAccountId: ACC.tax,
      bankAccountId: ACC.bankGel,
    };
    expect(() => taxPayment({ ...base, amount: money(1n, 'USD') })).toThrow(CurrencyMismatchError);
    expect(() => taxPayment({ ...base, amount: money(0n, 'GEL') })).toThrow(
      InvalidTransactionError,
    );
  });
});

describe('reverse', () => {
  const original = {
    id: 'tx-1',
    ...incomeReceipt({
      occurredOn: '2026-09-03',
      description: 'Invoice 7',
      bankAccountId: ACC.bankUsd,
      incomeAccountId: ACC.income,
      amount: money(100_000n, 'USD'),
      rate: usdRate,
    }),
  };

  it('negates every posting and links back to the original', () => {
    const r = reverse(original);
    expect(r.source).toBe('reversal');
    expect(r.reversesId).toBe('tx-1');
    expect(r.occurredOn).toBe('2026-09-03');
    expect(r.paymentMethod).toBe('bank');
    expect(r.description).toBe('Reversal: Invoice 7');
    expect(r.postings.map((x) => [x.accountId, x.amountMinor, x.gelAmountMinor, x.rateId])).toEqual(
      [
        [ACC.bankUsd, -100_000n, -270_000n, usdRate.id],
        [ACC.income, 100_000n, 270_000n, usdRate.id],
      ],
    );
  });

  it('can be dated later and described explicitly', () => {
    const r = reverse(original, { occurredOn: '2026-10-01', description: 'Refund' });
    expect(r.occurredOn).toBe('2026-10-01');
    expect(r.description).toBe('Refund');
    expect(() => reverse(original, { occurredOn: 'yesterday' })).toThrow(InvalidDateError);
  });

  it('refuses to reverse an unbalanced transaction', () => {
    expect(() => reverse({ ...original, postings: [p('a', 1n), p('b', 1n)] })).toThrow(
      UnbalancedTransactionError,
    );
  });

  const balancedTransaction = fc
    .array(
      fc.record({
        currency: fc.constantFrom('GEL', 'USD', 'EUR', 'GBP'),
        amounts: fc.array(fc.bigInt({ min: -(10n ** 12n), max: 10n ** 12n }), {
          minLength: 1,
          maxLength: 4,
        }),
      }),
      { minLength: 1, maxLength: 4 },
    )
    .map((groups) =>
      groups.flatMap(({ currency, amounts }, g) => {
        const balancing = -amounts.reduce((a, b) => a + b, 0n);
        return [...amounts, balancing].map((amountMinor, i): PostingDraft => ({
          accountId: `acc-${g}-${i}`,
          amountMinor,
          currency,
          gelAmountMinor: amountMinor * 3n,
          rateId: currency === 'GEL' ? null : `rate-${currency}`,
        }));
      }),
    );

  it('property: the reversal of any balanced transaction is balanced and nets it to zero', () => {
    fc.assert(
      fc.property(balancedTransaction, (postings) => {
        assertBalanced(postings);
        const r = reverse({
          id: 'tx',
          occurredOn: '2026-01-01',
          description: 'd',
          paymentMethod: null,
          postings,
        });
        expect(isBalanced(r.postings)).toBe(true);

        const net = new Map<string, { amount: bigint; gel: bigint }>();
        for (const x of [...postings, ...r.postings]) {
          const key = `${x.accountId}|${x.currency}`;
          const acc = net.get(key) ?? { amount: 0n, gel: 0n };
          net.set(key, { amount: acc.amount + x.amountMinor, gel: acc.gel + x.gelAmountMinor });
        }
        for (const { amount, gel } of net.values()) {
          expect(amount).toBe(0n);
          expect(gel).toBe(0n);
        }
      }),
    );
  });
});
