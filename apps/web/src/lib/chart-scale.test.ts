import { describe, expect, it } from 'vitest';
import { niceAxis, share } from './chart-scale';

describe('niceAxis', () => {
  it('rounds the step up to 1, 2 or 5 times a power of ten', () => {
    expect(niceAxis(569_866n)).toEqual({ top: 800_000n, step: 200_000n });
    expect(niceAxis(400_000n)).toEqual({ top: 400_000n, step: 100_000n });
    expect(niceAxis(400_001n)).toEqual({ top: 800_000n, step: 200_000n });
    expect(niceAxis(1_900_000n)).toEqual({ top: 2_000_000n, step: 500_000n });
    expect(niceAxis(3_000_001n)).toEqual({ top: 4_000_000n, step: 1_000_000n });
  });

  it('has a default axis without income', () => {
    expect(niceAxis(0n)).toEqual({ top: 100n, step: 25n });
    expect(niceAxis(-5n)).toEqual({ top: 100n, step: 25n });
  });
});

describe('share', () => {
  it('is a 0..1 fraction, 0 for negative values', () => {
    expect(share(50n, 200n)).toBe(0.25);
    expect(share(-1n, 200n)).toBe(0);
    expect(share(1n, 0n)).toBe(0);
  });
});
