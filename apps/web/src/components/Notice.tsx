import { AlertCircle, AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import type { ReactNode } from 'react';
import { cx } from '@geo-ie-accounting/ui';

export type NoticeTone = 'info' | 'warning' | 'error' | 'success';

const styles: Record<NoticeTone, string> = {
  info: 'border-info/30 bg-info-soft text-info-fg',
  warning: 'border-warning/40 bg-warning-soft text-warning-fg',
  error: 'border-negative/30 bg-negative-soft text-negative-fg',
  success: 'border-positive/30 bg-positive-soft text-positive-fg',
};

const icons = { info: Info, warning: AlertTriangle, error: AlertCircle, success: CheckCircle2 };

/**
 * Inline message block. `error` is announced as an alert; the others are polite status
 * messages only when `live` is set (for messages that appear after an action).
 */
export function Notice({
  tone = 'info',
  title,
  children,
  actions,
  live = false,
  className,
}: {
  tone?: NoticeTone;
  title?: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  live?: boolean;
  className?: string;
}) {
  const Icon = icons[tone];
  const role = tone === 'error' ? 'alert' : live ? 'status' : undefined;
  return (
    <div
      {...(role ? { role } : {})}
      className={cx('flex gap-3 rounded-md border p-3 text-sm', styles[tone], className)}
    >
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {title ? <p className="font-medium">{title}</p> : null}
        {children ? <div className="text-fg">{children}</div> : null}
        {actions ? <div className="mt-1 flex flex-wrap gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}
