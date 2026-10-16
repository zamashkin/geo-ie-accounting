import type { Schemas } from '@/lib/api/client';
import { Badge, type BadgeTone, cx } from '@ie-ledger/ui';
import { formatBp, formatMinor } from '@/lib/format';

type LimitStatus = Schemas['AnnualLimitStatus'];

const STATUS: Record<LimitStatus, { label: string; tone: BadgeTone }> = {
  ok: { label: 'Within the limit', tone: 'positive' },
  warn80: { label: 'Over 80% of the limit', tone: 'warning' },
  warn95: { label: 'Over 95% of the limit', tone: 'warning' },
  exceeded: { label: 'Limit exceeded', tone: 'negative' },
  exceeded_second_year: { label: 'Limit exceeded two years running', tone: 'negative' },
};

/**
 * Year-to-date SBS income against the annual limit. The limit and the share used come from
 * the API (tax rules of the year); nothing about the limit is known here.
 */
export function LimitMeter({
  ytdGelMinor,
  limitGelMinor,
  usedBp,
  status,
  className,
}: {
  ytdGelMinor: string;
  limitGelMinor: string;
  usedBp: number;
  status: LimitStatus;
  className?: string;
}) {
  const { label, tone } = STATUS[status];
  const width = Math.min(usedBp, 10_000) / 100;
  const share = formatBp(usedBp);
  return (
    <div className={cx('flex flex-col gap-2', className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-sm tabular-nums">
          <span className="font-medium">{formatMinor(ytdGelMinor, 'GEL')}</span>{' '}
          <span className="text-fg-muted">of {formatMinor(limitGelMinor, 'GEL')}</span>
        </p>
        <Badge tone={tone} dot>
          {label}
        </Badge>
      </div>
      <div
        role="meter"
        aria-label="Annual limit used"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(usedBp, 10_000) / 100}
        aria-valuetext={`${share} of the annual limit`}
        className="h-2.5 overflow-hidden rounded-full bg-surface-muted ring-1 ring-line ring-inset"
      >
        <div
          className={cx(
            'h-full rounded-full',
            tone === 'negative' ? 'bg-negative' : tone === 'warning' ? 'bg-warning' : 'bg-accent',
          )}
          style={{ width: `${width}%` }}
        />
      </div>
      <p className="text-xs text-fg-muted tabular-nums">{share} used</p>
    </div>
  );
}
