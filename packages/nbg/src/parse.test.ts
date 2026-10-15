import { describe, expect, it } from 'vitest';
import { NbgResponseError } from './errors';
import { nbgSetTimeToUtc, parseNbgResponse } from './parse';
import { readNbgFixture } from './testing';

const parseFixture = (name: string, date: string) =>
  parseNbgResponse(readNbgFixture(`${name}_${date}.json`), date);

describe('parseNbgResponse on recorded fixtures', () => {
  it('parses a weekday: the rate set the evening before, valid from the requested day', () => {
    const rates = parseFixture('EUR-GBP-USD', '2026-10-13');
    expect(rates).toEqual([
      {
        currency: 'EUR',
        validFrom: '2026-10-13',
        rate: '2.9066',
        quantity: 1,
        setAt: '2026-10-12T13:01:08.293Z',
        name: 'Euro',
      },
      expect.objectContaining({ currency: 'GBP', rate: '3.4395', validFrom: '2026-10-13' }),
      expect.objectContaining({ currency: 'USD', rate: '2.5994', validFrom: '2026-10-13' }),
    ]);
  });

  it.each(['2026-10-10', '2026-10-11', '2026-10-12'])(
    'gives %s (weekend or the Monday after) the rate set on Friday evening',
    (date) => {
      const usd = parseFixture('EUR-GBP-USD', date).find((r) => r.currency === 'USD');
      expect(usd).toMatchObject({
        validFrom: '2026-10-10',
        rate: '2.6005',
        setAt: '2026-10-09T13:01:01.779Z',
      });
    },
  );

  it('keeps the pre-holiday rate through the 14 Oct holiday and the day after', () => {
    for (const date of ['2026-10-14', '2026-10-15']) {
      const usd = parseFixture('EUR-GBP-USD', date).find((r) => r.currency === 'USD');
      expect(usd).toMatchObject({ validFrom: '2026-10-14', rate: '2.5989' });
    }
    expect(parseFixture('EUR-GBP-USD', '2026-10-16')[2]).toMatchObject({
      validFrom: '2026-10-16',
      rate: '2.5987',
    });
  });

  it('spans the April 9 holiday and Orthodox Easter with one rate', () => {
    for (const date of ['2026-04-09', '2026-04-10', '2026-04-11', '2026-04-13', '2026-04-14']) {
      expect(parseFixture('USD', date)).toEqual([
        expect.objectContaining({ validFrom: '2026-04-09', rate: '2.6965' }),
      ]);
    }
    expect(parseFixture('USD', '2026-04-15')[0]).toMatchObject({ validFrom: '2026-04-15' });
  });

  it('reads the GBP rates the BoG statement fixture relies on', () => {
    expect(parseFixture('GBP', '2025-06-04')[0]!.rate).toBe('3.6924');
    expect(parseFixture('GBP', '2025-06-05')[0]!.rate).toBe('3.6948');
    expect(parseFixture('GBP', '2025-06-11')[0]!.rate).toBe('3.6858');
  });

  it('keeps quantity for currencies quoted per 100 or 1000 units', () => {
    const rates = parseFixture('AMD-JPY-USD', '2026-10-14');
    expect(rates.map((r) => [r.currency, r.quantity, r.rate])).toEqual([
      ['AMD', 1000, '7.1690'],
      ['JPY', 100, '1.6436'],
      ['USD', 1, '2.5989'],
    ]);
  });

  it('returns no rates for an unknown code', () => {
    expect(parseFixture('XXX', '2026-10-14')).toEqual([]);
  });
});

describe('parseNbgResponse rejects', () => {
  const entry = {
    code: 'USD',
    quantity: 1,
    rateFormated: '2.5989',
    rate: 2.5989,
    name: 'US Dollar',
    date: '2026-10-13T17:01:10.440Z',
    validFromDate: '2026-10-14T00:00:00.000Z',
  };
  const body = (e: object) => [{ date: '2026-10-14T00:00:00.000Z', currencies: [e] }];

  it('takes the rate from rateFormated, never from the float', () => {
    const [rate] = parseNbgResponse(
      body({ ...entry, rateFormated: '2.4760', rate: 2.476 }),
      '2026-10-14',
    );
    expect(rate!.rate).toBe('2.4760');
  });

  it.each([
    ['a non-object body', { error: 'x' }],
    ['a missing rateFormated', body({ ...entry, rateFormated: undefined })],
    ['a rate with too many decimals', body({ ...entry, rateFormated: '2.1234567' })],
    ['a negative-looking rate', body({ ...entry, rateFormated: '-2.5' })],
    ['a zero rate', body({ ...entry, rateFormated: '0.0000' })],
    ['a zero quantity', body({ ...entry, quantity: 0 })],
    ['a lowercase code', body({ ...entry, code: 'usd' })],
    ['a malformed validFromDate', body({ ...entry, validFromDate: '14/10/2026' })],
  ])('%s', (_label, input) => {
    expect(() => parseNbgResponse(input, '2026-10-14')).toThrow(NbgResponseError);
  });

  it('a rate valid from after the requested date', () => {
    expect(() => parseNbgResponse(body(entry), '2026-10-13')).toThrow(/after the requested/);
  });

  it('a currency listed twice', () => {
    const twice = [{ date: '2026-10-14T00:00:00.000Z', currencies: [entry, entry] }];
    expect(() => parseNbgResponse(twice, '2026-10-14')).toThrow(/twice/);
  });
});

describe('nbgSetTimeToUtc', () => {
  it('reads the Z-labelled wall clock as Tbilisi time (UTC+4)', () => {
    expect(nbgSetTimeToUtc('2026-10-15T17:01:15.076Z')).toBe('2026-10-15T13:01:15.076Z');
    expect(nbgSetTimeToUtc('2026-01-01T02:00:00Z')).toBe('2025-12-31T22:00:00.000Z');
  });
});
