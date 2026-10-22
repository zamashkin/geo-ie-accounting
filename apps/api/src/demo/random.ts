// Deterministic randomness for the demo seed: the same seed string always gives the same
// sequence, so a re-run books exactly the same workspace. Not for anything secret.

/** FNV-1a, 32-bit: turns a seed string into the PRNG state. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export interface Random {
  /** Integer in [min, max], both inclusive. */
  int(min: number, max: number): number;
  /** Bigint in [min, max], both inclusive (amounts in minor units). */
  bigint(min: bigint, max: bigint): bigint;
  /** True with probability `p`. */
  chance(p: number): boolean;
  pick<T>(items: readonly T[]): T;
}

/** mulberry32 seeded from `seed`. Each distinct seed string is an independent stream. */
export function random(seed: string): Random {
  let state = hash(seed);
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1));
  return {
    int,
    bigint: (min, max) => {
      const span = max - min;
      if (span < 0n) throw new RangeError('max below min');
      // Spans used here fit easily in 2^31; draw the offset as an integer.
      return min + BigInt(int(0, Number(span)));
    },
    chance: (p) => next() < p,
    pick: (items) => {
      const item = items[int(0, items.length - 1)];
      if (item === undefined) throw new RangeError('pick from an empty list');
      return item;
    },
  };
}
