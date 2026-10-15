import type { ReactNode } from 'react';
import { cx } from '../../lib/cx';

export interface EmptyStateProps {
  /** Decorative icon (rendered aria-hidden). */
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** Primary and secondary actions, e.g. a Button or ButtonLink. */
  actions?: ReactNode;
  /** Heading level for the title, so it fits the page outline. Default 2. */
  headingLevel?: 2 | 3 | 4;
  className?: string;
}

/** Explains why a view is empty and what to do next. */
export function EmptyState({
  icon,
  title,
  description,
  actions,
  headingLevel = 2,
  className,
}: EmptyStateProps) {
  const Heading = `h${headingLevel}` as const;
  return (
    <div
      className={cx(
        'flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-line px-6 py-12 text-center',
        className,
      )}
    >
      {icon ? (
        <div
          aria-hidden
          className="flex size-11 items-center justify-center rounded-full bg-accent-soft text-accent-soft-fg [&_svg]:size-5"
        >
          {icon}
        </div>
      ) : null}
      <div className="flex max-w-sm flex-col gap-1">
        <Heading className="text-base font-semibold text-fg">{title}</Heading>
        {description ? <p className="text-sm text-fg-muted">{description}</p> : null}
      </div>
      {actions ? <div className="mt-2 flex flex-wrap justify-center gap-2">{actions}</div> : null}
    </div>
  );
}
