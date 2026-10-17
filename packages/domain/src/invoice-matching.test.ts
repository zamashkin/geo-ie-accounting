import { describe, expect, it } from 'vitest';
import {
  compareMatches,
  nameSimilarity,
  nameTokens,
  scorePaymentMatch,
  type MatchableInvoice,
  type MatchablePayment,
} from './invoice-matching';

const invoice: MatchableInvoice = {
  currency: 'USD',
  outstandingMinor: 150000n,
  issueDate: '2026-09-01',
  dueDate: '2026-09-15',
  clientName: 'Acme Software LLC',
};

const payment = (over: Partial<MatchablePayment> = {}): MatchablePayment => ({
  currency: 'USD',
  availableMinor: 150000n,
  occurredOn: '2026-09-10',
  counterparty: 'ACME SOFTWARE, L.L.C.',
  ...over,
});

describe('nameTokens', () => {
  it('drops case, accents, punctuation and legal forms', () => {
    expect(nameTokens('ACME Software, L.L.C.')).toEqual(['acme', 'software']);
    expect(nameTokens('Société Générale S.A.')).toEqual(['societe', 'generale']);
    expect(nameTokens('  ')).toEqual([]);
  });

  it('transliterates Georgian and drops its legal forms', () => {
    expect(nameTokens('შპს ბერიძე')).toEqual(['beridze']);
    expect(nameTokens('ი/მ გიორგი ბერიძე')).toEqual(['giorgi', 'beridze']);
  });
});

describe('nameSimilarity', () => {
  it('ignores word order, case and legal forms', () => {
    expect(nameSimilarity('Giorgi Beridze', 'BERIDZE GIORGI')).toBe(100);
    expect(nameSimilarity('Acme Software LLC', 'acme software')).toBe(100);
    expect(nameSimilarity('შპს ბერიძე', 'Beridze LLC')).toBe(100);
  });

  it('scores a shorter name contained in the longer one, and typos, as similar', () => {
    expect(nameSimilarity('Acme', 'ACME SOFTWARE GMBH')).toBeGreaterThanOrEqual(80);
    expect(nameSimilarity('Acme Software', 'Acme Sofware')).toBeGreaterThanOrEqual(80);
  });

  it('scores different names low', () => {
    expect(nameSimilarity('Acme Software', 'Globex Corporation')).toBeLessThan(30);
    expect(nameSimilarity('Acme', '')).toBe(0);
  });
});

describe('scorePaymentMatch', () => {
  it('an exact amount from the client is a strong match and allocates the whole amount', () => {
    const m = scorePaymentMatch(invoice, payment());
    expect(m).toMatchObject({ amountMatch: 'exact', nameScore: 100, allocateMinor: 150000n });
    expect(m?.score).toBe(100);
  });

  it('needs the invoice currency and a date on or after the issue date', () => {
    expect(scorePaymentMatch(invoice, payment({ currency: 'EUR' }))).toBeNull();
    expect(scorePaymentMatch(invoice, payment({ occurredOn: '2026-08-31' }))).toBeNull();
    expect(scorePaymentMatch(invoice, payment({ occurredOn: '2026-09-01' }))).not.toBeNull();
  });

  it('allows a partial payment and allocates only what arrived', () => {
    const m = scorePaymentMatch(invoice, payment({ availableMinor: 50000n }));
    expect(m).toMatchObject({ amountMatch: 'partial', allocateMinor: 50000n });
  });

  it('allocates only what is owed from a larger payment', () => {
    const m = scorePaymentMatch(invoice, payment({ availableMinor: 300000n }));
    expect(m).toMatchObject({ amountMatch: 'over', allocateMinor: 150000n });
  });

  it('wants the counterparty to resemble the client', () => {
    expect(scorePaymentMatch(invoice, payment({ counterparty: 'Globex Corporation' }))).toBeNull();
  });

  it('takes an exact amount without a counterparty, but not a partial one', () => {
    const m = scorePaymentMatch(invoice, payment({ counterparty: null }));
    expect(m).toMatchObject({ amountMatch: 'exact', nameScore: null });
    expect(m?.score).toBe(60);
    expect(
      scorePaymentMatch(invoice, payment({ counterparty: ' ', availableMinor: 1n })),
    ).toBeNull();
  });

  it('ranks a payment by the due date above a late one', () => {
    const onTime = scorePaymentMatch(invoice, payment());
    const late = scorePaymentMatch(invoice, payment({ occurredOn: '2027-01-10' }));
    expect(onTime && late && onTime.score > late.score).toBe(true);
  });

  it('nothing to match when nothing is owed or nothing is left of the payment', () => {
    expect(scorePaymentMatch({ ...invoice, outstandingMinor: 0n }, payment())).toBeNull();
    expect(scorePaymentMatch(invoice, payment({ availableMinor: 0n }))).toBeNull();
  });
});

describe('compareMatches', () => {
  it('sorts by score, then the earlier payment', () => {
    const m = (score: number) => ({
      score,
      amountMatch: 'exact' as const,
      nameScore: 100,
      allocateMinor: 1n,
    });
    const list = [
      { match: m(70), occurredOn: '2026-09-02' },
      { match: m(90), occurredOn: '2026-09-05' },
      { match: m(70), occurredOn: '2026-09-01' },
    ].sort(compareMatches);
    expect(list.map((x) => `${x.match.score}@${x.occurredOn}`)).toEqual([
      '90@2026-09-05',
      '70@2026-09-01',
      '70@2026-09-02',
    ]);
  });
});
