import type { HTMLAttributes } from 'react';
import { cx } from '../../lib/cx';

/** Bordered surface for grouping content (forms, widgets). */
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      className={cx('rounded-lg border border-line bg-surface shadow-sm', className)}
    />
  );
}
