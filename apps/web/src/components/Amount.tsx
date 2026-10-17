import { cx } from '@geo-ie-accounting/ui';
import { type FormatMinorOptions, formatMinor, parseMinor } from '@/lib/format';

/**
 * An amount in minor units with tabular figures. `signed` colours negatives and positives; the
 * sign is always in the text too, so colour is never the only signal.
 */
export function Amount({
  minor,
  currency,
  tone = 'neutral',
  className,
  ...options
}: FormatMinorOptions & {
  minor: string;
  currency: string;
  tone?: 'neutral' | 'signed';
  className?: string;
}) {
  const value = parseMinor(minor);
  return (
    <span
      className={cx(
        'whitespace-nowrap tabular-nums',
        tone === 'signed' && value < 0n && 'text-negative-fg',
        tone === 'signed' && value > 0n && 'text-positive-fg',
        className,
      )}
    >
      {formatMinor(value, currency, options)}
    </span>
  );
}
