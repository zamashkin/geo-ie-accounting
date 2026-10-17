import { cx } from '@geo-ie-accounting/ui';
import { niceAxis, share } from '@/lib/chart-scale';
import { formatMinor, formatPeriod, parseMinor } from '@/lib/format';

// Hand-rolled SVG and HTML charts (ADR 0014): rendered on the server, no chart library and no
// client JavaScript. Geometry is computed from bigint amounts by integer division; the
// floats only position marks, they never become money. Every chart has a text alternative.

const shortGel = (minor: bigint) =>
  formatMinor((minor / 100n) * 100n, 'GEL', { display: 'none' }).replace(/\.00$/, '');

/** Twelve monthly bars of SBS income, January first. */
export function MonthlyIncomeChart({
  months,
}: {
  months: readonly { period: string; incomeGelMinor: string; taxGelMinor: string }[];
}) {
  const values = months.map((m) => parseMinor(m.incomeGelMinor));
  const max = values.reduce((a, b) => (b > a ? b : a), 0n);
  const { top, step } = niceAxis(max);
  const W = 640;
  const H = 220;
  const left = 56;
  const bottom = 24;
  const plotH = H - bottom - 8;
  const plotW = W - left - 4;
  const slot = plotW / months.length;
  const barW = Math.min(28, slot * 0.6);
  const ticks: bigint[] = [];
  for (let t = 0n; t <= top; t += step) ticks.push(t);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-auto w-full"
      role="img"
      aria-label="SBS income by month, GEL. The table below has the same figures."
    >
      {ticks.map((t) => {
        const y = 8 + plotH - share(t, top) * plotH;
        return (
          <g key={t.toString()}>
            <line
              x1={left}
              x2={W - 4}
              y1={y}
              y2={y}
              className={t === 0n ? 'stroke-line-strong' : 'stroke-line'}
              strokeWidth={1}
            />
            <text x={left - 6} y={y + 4} textAnchor="end" className="fill-fg-muted text-[11px]">
              {shortGel(t)}
            </text>
          </g>
        );
      })}
      {months.map((m, i) => {
        const v = values[i] ?? 0n;
        const h = share(v, top) * plotH;
        const x = left + slot * i + (slot - barW) / 2;
        const y = 8 + plotH - h;
        const r = Math.min(4, h / 2);
        return (
          <g key={m.period} className="group">
            <title>{`${formatPeriod(m.period)}: ${formatMinor(m.incomeGelMinor, 'GEL')}, tax ${formatMinor(m.taxGelMinor, 'GEL')}`}</title>
            {/* Hit target taller and wider than the bar. */}
            <rect
              x={left + slot * i}
              y={8}
              width={slot}
              height={plotH}
              className="fill-transparent"
            />
            {h > 0 ? (
              <path
                d={`M${x},${8 + plotH} V${y + r} Q${x},${y} ${x + r},${y} H${x + barW - r} Q${x + barW},${y} ${x + barW},${y + r} V${8 + plotH} Z`}
                className="fill-accent group-hover:fill-accent-hover"
              />
            ) : null}
            <text
              x={left + slot * i + slot / 2}
              y={H - 6}
              textAnchor="middle"
              className="fill-fg-muted text-[11px]"
            >
              {formatPeriod(m.period).slice(0, 3)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export interface BarListItem {
  key: string;
  label: string;
  /** GEL minor units; the bar length. */
  valueMinor: string;
  detail?: string;
  muted?: boolean;
}

/** Horizontal bars with direct labels: one series, so no legend. */
export function BarList({ items, label }: { items: readonly BarListItem[]; label: string }) {
  const max = items.reduce((a, i) => {
    const v = parseMinor(i.valueMinor);
    return v > a ? v : a;
  }, 0n);
  return (
    <ul aria-label={label} className="flex flex-col gap-3">
      {items.map((i) => {
        const pct = share(parseMinor(i.valueMinor), max) * 100;
        return (
          <li key={i.key} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className={cx('min-w-0 truncate', i.muted && 'text-fg-muted')}>{i.label}</span>
              <span className="shrink-0 tabular-nums">
                {formatMinor(i.valueMinor, 'GEL', { display: 'none' })}
              </span>
            </div>
            <div aria-hidden className="h-2 rounded-full bg-surface-muted">
              <div
                className={cx('h-2 rounded-full', i.muted ? 'bg-fg-subtle' : 'bg-accent')}
                style={{ width: `${pct.toFixed(1)}%` }}
              />
            </div>
            {i.detail ? <span className="text-xs text-fg-muted">{i.detail}</span> : null}
          </li>
        );
      })}
    </ul>
  );
}
