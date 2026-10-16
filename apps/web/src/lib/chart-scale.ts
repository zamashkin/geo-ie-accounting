// Chart geometry from bigint amounts (ADR 0014). Fractions only position marks; they never
// become money.

const SCALE = 10_000n;

/** `value / max` as a fraction 0..1 for geometry, from bigints. Negative values count as 0. */
export function share(value: bigint, max: bigint): number {
  if (max <= 0n || value <= 0n) return 0;
  return Number((value * SCALE) / max) / Number(SCALE);
}

/** An axis of `ticks` round steps (1, 2 or 5 × 10^k minor units) whose top is at least `max`. */
export function niceAxis(maxMinor: bigint, ticks = 4): { top: bigint; step: bigint } {
  if (maxMinor <= 0n) return { top: 100n, step: 25n };
  const raw = (maxMinor + BigInt(ticks) - 1n) / BigInt(ticks);
  let magnitude = 1n;
  while (magnitude * 10n <= raw) magnitude *= 10n;
  const step = [1n, 2n, 5n].map((m) => m * magnitude).find((s) => s >= raw) ?? 10n * magnitude;
  return { top: step * BigInt(ticks), step };
}
