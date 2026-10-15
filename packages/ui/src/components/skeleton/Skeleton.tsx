import type { CSSProperties, ReactNode } from 'react';
import { cx } from '../../lib/cx';

export interface SkeletonProps {
  className?: string;
  style?: CSSProperties;
}

/** Placeholder block while content loads. Decorative: pair it with a Loading region. */
export function Skeleton({ className, style }: SkeletonProps) {
  return (
    <div
      aria-hidden
      style={style}
      className={cx('animate-shimmer rounded-md bg-surface-muted', className)}
    />
  );
}

export interface LoadingRegionProps {
  /** Announced to screen readers, e.g. "Loading transactions". */
  label: string;
  children: ReactNode;
  className?: string;
}

/** Wraps skeletons so assistive tech hears one "busy" message instead of nothing. */
export function LoadingRegion({ label, children, className }: LoadingRegionProps) {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className={className}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

/** A few lines of text-shaped skeletons. */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cx('flex flex-col gap-2', className)}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={cx('h-3.5', i === lines - 1 ? 'w-3/5' : 'w-full')} />
      ))}
    </div>
  );
}
