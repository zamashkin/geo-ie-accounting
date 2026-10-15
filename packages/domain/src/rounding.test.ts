import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DomainError } from './errors';
import { DEFAULT_ROUNDING_MODE, ROUNDING_MODES, round, roundToStep } from './rounding';
import type { RoundingMode } from './rounding';

// numerator / 10 → expected result per mode, in ROUNDING_MODES order.
// prettier-ignore
const TABLE: [bigint, ...bigint[]][] = [
  //       half_even half_up half_down  up   down ceiling floor
  [25n,    2n,       3n,     2n,        3n,  2n,  3n,     2n],
  [35n,    4n,       4n,     3n,        4n,  3n,  4n,     3n],
  [24n,    2n,       2n,     2n,        3n,  2n,  3n,     2n],
  [26n,    3n,       3n,     3n,        3n,  2n,  3n,     2n],
  [5n,     0n,       1n,     0n,        1n,  0n,  1n,     0n],
  [20n,    2n,       2n,     2n,        2n,  2n,  2n,     2n],
  [-25n,  -2n,      -3n,    -2n,       -3n, -2n, -2n,    -3n],
  [-35n,  -4n,      -4n,    -3n,       -4n, -3n, -3n,    -4n],
  [-24n,  -2n,      -2n,    -2n,       -3n, -2n, -2n,    -3n],
  [-26n,  -3n,      -3n,    -3n,       -3n, -2n, -2n,    -3n],
  [-5n,    0n,      -1n,     0n,       -1n,  0n,  0n,    -1n],
  [0n,     0n,       0n,     0n,        0n,  0n,  0n,     0n],
];

describe('round', () => {
  it('defaults to half-even until Q6 is decided (ADR 0007)', () => {
    expect(DEFAULT_ROUNDING_MODE).toBe('half_even');
    expect(round(25n, 10n)).toBe(2n);
    expect(round(35n, 10n)).toBe(4n);
  });

  for (const [value, ...expected] of TABLE) {
    ROUNDING_MODES.forEach((mode, i) => {
      it(`${value}/10 with ${mode} → ${expected[i]}`, () => {
        expect(round(value, 10n, mode)).toBe(expected[i]);
      });
    });
  }

  it('handles a negative denominator', () => {
    expect(round(25n, -10n, 'half_up')).toBe(-3n);
    expect(round(-25n, -10n, 'floor')).toBe(2n);
  });

  it('throws a typed error on division by zero', () => {
    expect(() => round(1n, 0n)).toThrow(DomainError);
    expect(() => round(1n, 0n)).toThrow(expect.objectContaining({ code: 'division_by_zero' }));
  });

  it('works beyond 2^64 without precision loss', () => {
    // 2^80 + 0.5: a tie whose lower neighbour (2^80) is even.
    expect(round(2n ** 80n * 10n + 5n, 10n, 'half_even')).toBe(2n ** 80n);
    expect(round(2n ** 80n * 10n + 5n, 10n, 'half_up')).toBe(2n ** 80n + 1n);
  });

  const nd = fc.tuple(
    fc.bigInt({ min: -(10n ** 30n), max: 10n ** 30n }),
    fc.bigInt({ min: 1n, max: 10n ** 15n }),
  );

  it('property: half modes are within half a unit, directed modes within one unit', () => {
    fc.assert(
      fc.property(nd, fc.constantFrom(...ROUNDING_MODES), ([n, d], mode) => {
        const error = round(n, d, mode) * d - n;
        const absError = error < 0n ? -error : error;
        if (mode.startsWith('half_')) expect(2n * absError <= d).toBe(true);
        else expect(absError < d).toBe(true);
      }),
    );
  });

  it('property: floor ≤ exact ≤ ceiling, and down/up bracket toward/away from zero', () => {
    fc.assert(
      fc.property(nd, ([n, d]) => {
        expect(round(n, d, 'floor') * d <= n).toBe(true);
        expect(round(n, d, 'ceiling') * d >= n).toBe(true);
        const down = round(n, d, 'down');
        const up = round(n, d, 'up');
        expect(down * d * (n < 0n ? -1n : 1n) <= (n < 0n ? -n : n)).toBe(true);
        expect(up * d * (n < 0n ? -1n : 1n) >= (n < 0n ? -n : n)).toBe(true);
      }),
    );
  });

  it('property: symmetric modes satisfy round(−x) = −round(x)', () => {
    const symmetric: RoundingMode[] = ['half_even', 'half_up', 'half_down', 'up', 'down'];
    fc.assert(
      fc.property(nd, fc.constantFrom(...symmetric), ([n, d], mode) => {
        expect(round(-n, d, mode)).toBe(-round(n, d, mode));
      }),
    );
  });
});

describe('roundToStep', () => {
  it('rounds tetri to whole lari', () => {
    expect(roundToStep(12350n, 100n, 'half_even')).toBe(12400n);
    expect(roundToStep(12250n, 100n, 'half_even')).toBe(12200n);
    expect(roundToStep(12250n, 100n, 'half_up')).toBe(12300n);
    expect(roundToStep(12301n, 100n, 'ceiling')).toBe(12400n);
  });

  it('rejects a non-positive step', () => {
    expect(() => roundToStep(1n, 0n)).toThrow(DomainError);
  });
});
