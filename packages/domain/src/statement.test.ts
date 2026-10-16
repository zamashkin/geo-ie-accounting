// Domain pieces the MVP import pipeline relies on: statement-line builder, cross-format dedupe
// and the June 2025 figures from the BoG fixture (docs/MVP.md).
import { describe, expect, it } from 'vitest';
import { dedupeHash, dedupeHashes, documentDedupeHash } from './dedupe';
import type { DedupeInput } from './dedupe';
import { InvalidTransactionError } from './errors';
import { parseRate } from './fx';
import { bankStatementLine, isBalanced, reverse } from './ledger';
import type { RateSnapshot } from './ledger';
import { money } from './money';
import { annualLimitUsageBp, computeDeclarationYear } from './tax/declaration';
import type { SbsIncomeEntry } from './tax/declaration';

const gbp = (rate: string, id: string): RateSnapshot => ({
  id,
  rateScaled: parseRate(rate),
  quantity: 1,
  currency: 'GBP',
});

describe('bankStatementLine', () => {
  it('books incoming GBP income at the NBG rate (1,180.00 × 3.6924 = 4,357.03)', () => {
    const draft = bankStatementLine({
      occurredOn: '2025-06-04',
      description: 'Incoming transfer',
      bankAccountId: 'bank-gbp',
      counterAccountId: 'income-sbs',
      amount: money(118000n, 'GBP'),
      rate: gbp('3.6924', 'rate-0604'),
      paymentMethod: 'bank',
    });
    expect(draft.source).toBe('import');
    expect(draft.paymentMethod).toBe('bank');
    expect(draft.postings).toEqual([
      {
        accountId: 'bank-gbp',
        amountMinor: 118000n,
        currency: 'GBP',
        gelAmountMinor: 435703n,
        rateId: 'rate-0604',
      },
      {
        accountId: 'income-sbs',
        amountMinor: -118000n,
        currency: 'GBP',
        gelAmountMinor: -435703n,
        rateId: 'rate-0604',
      },
    ]);
  });

  it('books money out the other way round (a conversion leg against FX Clearing)', () => {
    const draft = bankStatementLine({
      occurredOn: '2025-06-05',
      description: 'Conversion GBP → USD',
      bankAccountId: 'bank-gbp',
      counterAccountId: 'fx-clearing',
      amount: money(-69085n, 'GBP'),
      rate: gbp('3.6948', 'rate-0605'),
      paymentMethod: null,
    });
    expect(draft.postings.map((p) => [p.accountId, p.amountMinor, p.gelAmountMinor])).toEqual([
      ['bank-gbp', -69085n, -255255n],
      ['fx-clearing', 69085n, 255255n],
    ]);
    expect(isBalanced(draft.postings)).toBe(true);
    expect(draft.paymentMethod).toBeNull();
  });

  it('needs no rate for GEL and keeps the GEL amount', () => {
    const draft = bankStatementLine({
      occurredOn: '2025-06-05',
      description: 'Fee',
      bankAccountId: 'bank-gel',
      counterAccountId: 'fees',
      amount: money(-150n, 'GEL'),
      rate: null,
      paymentMethod: null,
    });
    expect(draft.postings[0]).toMatchObject({ gelAmountMinor: -150n, rateId: null });
  });

  it('rejects a zero amount and a line against its own account', () => {
    const base = {
      occurredOn: '2025-06-05',
      description: 'x',
      bankAccountId: 'a',
      counterAccountId: 'b',
      rate: null,
      paymentMethod: null,
    };
    expect(() => bankStatementLine({ ...base, amount: money(0n, 'GEL') })).toThrow(
      InvalidTransactionError,
    );
    expect(() =>
      bankStatementLine({ ...base, counterAccountId: 'a', amount: money(1n, 'GEL') }),
    ).toThrow(InvalidTransactionError);
  });
});

describe('cross-format dedupe', () => {
  const xlsx: DedupeInput = {
    accountId: 'acc',
    bookedOn: '2025-06-04',
    amountMinor: 118000n,
    currency: 'GBP',
    bankReference: '90000000001',
    documentNumber: 'PMI100000001',
    counterparty: 'EXAMPLE CLIENT LIMITED',
    description: 'Incoming Transfer',
  };
  // The CSV export of the same operation: no operation id, different description text.
  const csv: DedupeInput = {
    ...xlsx,
    bankReference: null,
    counterparty: null,
    description: 'PETROV: Incoming Transfer - Amount: GBP1,180.00',
  };

  it('primary hashes differ between the exports, the document hash matches', () => {
    expect(dedupeHash(xlsx)).not.toBe(dedupeHash(csv));
    expect(documentDedupeHash(xlsx)).toBe(documentDedupeHash(csv));
    expect(dedupeHashes(xlsx)).toContain(documentDedupeHash(csv));
  });

  it('a CSV line has one fingerprint: its primary hash is already the document hash', () => {
    expect(dedupeHashes(csv)).toEqual([dedupeHash(csv)]);
  });

  it('a line without a document number has no document hash', () => {
    expect(documentDedupeHash({ ...xlsx, documentNumber: '  ' })).toBeNull();
    expect(dedupeHashes({ ...xlsx, documentNumber: null })).toHaveLength(1);
  });

  it('the document hash still depends on account, date and amount', () => {
    expect(documentDedupeHash({ ...xlsx, amountMinor: 118001n })).not.toBe(
      documentDedupeHash(xlsx),
    );
    expect(documentDedupeHash({ ...xlsx, accountId: 'other' })).not.toBe(documentDedupeHash(xlsx));
  });
});

describe('June 2025 BoG fixture figures (docs/MVP.md)', () => {
  const lines = [
    { date: '2025-06-04', amount: 118000n, rate: gbp('3.6924', 'r1') },
    { date: '2025-06-11', amount: 36400n, rate: gbp('3.6858', 'r2') },
  ];
  const drafts = lines.map((l) =>
    bankStatementLine({
      occurredOn: l.date,
      description: 'Incoming transfer',
      bankAccountId: 'bank-gbp',
      counterAccountId: 'income-sbs',
      amount: money(l.amount, 'GBP'),
      rate: l.rate,
      paymentMethod: 'bank',
    }),
  );
  const entries = (ds: typeof drafts): SbsIncomeEntry[] =>
    ds.flatMap((d) =>
      d.postings
        .filter((p) => p.accountId === 'income-sbs')
        .map((p) => ({
          occurredOn: d.occurredOn,
          gelAmountMinor: p.gelAmountMinor,
          paymentMethod: d.paymentMethod,
        })),
    );

  it('income 5,698.66 on line 20, 1%, tax 56.99, due 2025-07-15', () => {
    const year = computeDeclarationYear({
      year: 2025,
      entries: entries(drafts),
      sbsEffectiveFrom: '2025-01-01',
    });
    const june = year.months[5];
    expect(june).toMatchObject({
      period: '2025-06',
      incomeGelMinor: 569866n,
      ytdGelMinor: 569866n,
      byPaymentMethod: { cash_register: 0n, pos: 0n, bank: 569866n, other: 0n },
      rateBp: 100,
      taxGelMinor: 5699n,
      deadline: '2025-07-15',
    });
  });

  it('a reversal takes the income back out', () => {
    const [first] = drafts;
    if (!first) throw new Error('no draft');
    const reversal = reverse({ id: 'tx1', ...first });
    const year = computeDeclarationYear({
      year: 2025,
      entries: entries([...drafts, reversal]),
      sbsEffectiveFrom: '2025-01-01',
    });
    expect(year.months[5]).toMatchObject({ incomeGelMinor: 134163n, taxGelMinor: 1342n });
  });
});

describe('annualLimitUsageBp', () => {
  it('is the used share of GEL 500,000 in basis points, rounded down', () => {
    expect(annualLimitUsageBp(569866n)).toBe(113); // 1.1397%
    expect(annualLimitUsageBp(25_000_000n)).toBe(5000);
    expect(annualLimitUsageBp(60_000_000n)).toBe(12000);
    expect(annualLimitUsageBp(-5n)).toBe(0);
  });
});
