import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from '../../lib/cx';

export type BadgeTone = 'neutral' | 'accent' | 'positive' | 'negative' | 'warning' | 'info';

const tones: Record<BadgeTone, string> = {
  neutral: 'bg-surface-muted text-fg-muted ring-line',
  accent: 'bg-accent-soft text-accent-soft-fg ring-accent/20',
  positive: 'bg-positive-soft text-positive-fg ring-positive/25',
  negative: 'bg-negative-soft text-negative-fg ring-negative/25',
  warning: 'bg-warning-soft text-warning-fg ring-warning/40',
  info: 'bg-info-soft text-info-fg ring-info/25',
};

const dots: Record<BadgeTone, string> = {
  neutral: 'bg-fg-subtle',
  accent: 'bg-accent',
  positive: 'bg-positive',
  negative: 'bg-negative',
  warning: 'bg-warning',
  info: 'bg-info',
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  /** Leading status dot. Colour is never the only signal: the text says the status. */
  dot?: boolean;
  children: ReactNode;
}

/** Short status label, e.g. "Filed", "Duplicate", "3%". */
export function Badge({
  tone = 'neutral',
  dot = false,
  className,
  children,
  ...props
}: BadgeProps) {
  return (
    <span
      {...props}
      className={cx(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset',
        tones[tone],
        className,
      )}
    >
      {dot ? <span aria-hidden className={cx('size-1.5 rounded-full', dots[tone])} /> : null}
      {children}
    </span>
  );
}
