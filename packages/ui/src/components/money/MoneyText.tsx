import { cx } from '../../lib/cx';
import { type FormatMoneyOptions, formatMoneyToParts, toMinor } from '../../money/format';

export interface MoneyTextProps extends FormatMoneyOptions {
  /** Minor units: a bigint, or the decimal string from the API (`"125000"`). */
  amountMinor: bigint | string;
  currency: string;
  /** `signed` colours negatives red and positives green; `neutral` keeps the text colour. */
  tone?: 'neutral' | 'signed';
  className?: string;
}

/**
 * Formatted amount with tabular figures. The currency code is de-emphasised so columns of
 * numbers scan easily. Renders on the server too (no client JS).
 */
export function MoneyText({
  amountMinor,
  currency,
  tone = 'neutral',
  className,
  ...opts
}: MoneyTextProps) {
  const minor = toMinor(amountMinor);
  const parts = formatMoneyToParts(minor, currency, opts);
  return (
    <span
      className={cx(
        'whitespace-nowrap tabular-nums',
        tone === 'signed' && minor < 0n && 'text-negative-fg',
        tone === 'signed' && minor > 0n && 'text-positive-fg',
        className,
      )}
      data-negative={minor < 0n || undefined}
    >
      {parts.map((part, i) =>
        part.type === 'currency' ? (
          <span key={i} className="text-[0.85em] font-normal">
            {part.value}
          </span>
        ) : (
          part.value
        ),
      )}
    </span>
  );
}
