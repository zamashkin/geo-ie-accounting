import { Badge, ButtonLink, Card, PageContainer, PageHeader, cx } from '@ie-ledger/ui';
import type { Metadata, Route } from 'next';
import Link from 'next/link';
import { Notice } from '@/components/Notice';
import type { Schemas } from '@/lib/api/client';
import { serverApi, serverRead } from '@/lib/api/server';
import { formatBp, formatIsoDate, formatMinor, formatPeriod, parseMinor } from '@/lib/format';
import { orgHref } from '@/lib/nav';
import { parseYearParam, yearOptions } from '@/lib/years';
import { FilingStatusBadge } from '../_components/FilingStatusBadge';
import { LimitMeter } from '../_components/LimitMeter';
import { YearPicker } from '../_components/YearPicker';

export const metadata: Metadata = { title: 'Declarations' };

type Month = Schemas['DeclarationMonthView'];

const PAYMENT_LINES = [
  { key: 'cash_register', line: '18', label: 'Cash register' },
  { key: 'pos', line: '19', label: 'POS terminal' },
  { key: 'bank', line: '20', label: 'Bank account' },
  { key: 'other', line: '21', label: 'Other' },
] as const;

const amount = (minor: string) => formatMinor(minor, 'GEL', { display: 'none' });

function ReturnStatus({ month }: { month: Month }) {
  return (
    <span className="flex flex-wrap gap-1">
      <FilingStatusBadge status={month.status} zeroReturn={month.zeroReturn} />
      {month.sbsStatus === 'partial' ? <Badge tone="warning">Status from mid-month</Badge> : null}
      {month.negativeIncome ? <Badge tone="negative">Needs a correction</Badge> : null}
      {month.limitCrossedThisMonth ? <Badge tone="negative">Limit crossed</Badge> : null}
    </span>
  );
}

const th = 'px-2.5 py-2 font-medium whitespace-nowrap';
const td = 'px-2.5 py-2 whitespace-nowrap tabular-nums';

export default async function DeclarationsPage({
  params,
  searchParams,
}: PageProps<'/o/[orgId]/declarations'>) {
  const { orgId } = await params;
  // No `?year=`: the API picks the latest year with transactions (else the current year).
  const year = parseYearParam((await searchParams).year);
  const api = await serverApi();
  const decl = await serverRead(
    api.GET('/v1/orgs/{orgId}/declarations', {
      params: { path: { orgId }, query: year ? { year } : {} },
    }),
    orgHref(orgId, year ? `/declarations?year=${year}` : '/declarations'),
  );

  const excludedTotal = decl.months.reduce((sum, m) => sum + parseMinor(m.excludedGelMinor), 0n);
  const drifted = decl.months.filter((m) => m.status.kind === 'filed_with_drift');
  const showExcluded = decl.sbsEffectiveFrom === null || excludedTotal !== 0n;

  return (
    <PageContainer>
      <PageHeader
        title="Declarations"
        description={`Monthly small-business return figures for ${decl.year}, computed from the ledger. Open a month to copy its figures into rs.ge and record the filing.`}
        actions={
          <YearPicker year={decl.year} years={yearOptions(decl.year, decl.sbsEffectiveFrom)} />
        }
      />

      <div className="mb-6 flex flex-col gap-3">
        {decl.sbsEffectiveFrom === null ? (
          <Notice
            tone="warning"
            title="No small-business status start date"
            actions={
              <ButtonLink href={orgHref(orgId, '/settings')} size="sm" variant="secondary">
                Set the date
              </ButtonLink>
            }
          >
            Income is not declared without it.{' '}
            {excludedTotal !== 0n
              ? `${formatMinor(excludedTotal.toString(), 'GEL')} of income on small-business accounts is excluded from ${decl.year}.`
              : null}
          </Notice>
        ) : excludedTotal !== 0n ? (
          <Notice tone="info" title="Income before the status start is excluded">
            {formatMinor(excludedTotal.toString(), 'GEL')} booked before{' '}
            {formatIsoDate(decl.sbsEffectiveFrom)} is not declared.
          </Notice>
        ) : null}
        {drifted.length > 0 ? (
          <Notice tone="warning" title="Filed figures changed">
            The live figures of {drifted.map((m) => formatPeriod(m.period)).join(', ')} differ from
            what was filed. Open the month to see what moved and file a correction.
          </Notice>
        ) : null}
        {decl.limitExceeded ? (
          <Notice tone="error" title="Annual limit exceeded">
            Cumulative income went over the limit
            {decl.crossingPeriod ? ` in ${formatPeriod(decl.crossingPeriod)}` : ''}. The higher rate
            applies from then on, as shown below.
            {decl.previousYearLimitExceeded ? ' The previous year was over the limit too.' : ''}
          </Notice>
        ) : null}
      </div>

      <Card className="mb-6 p-4 sm:p-5">
        <h2 className="mb-3 text-sm font-medium text-fg-muted">
          {decl.year} income against the annual limit
        </h2>
        <LimitMeter
          ytdGelMinor={decl.totalIncomeGelMinor}
          limitGelMinor={decl.annualLimitGelMinor}
          usedBp={decl.annualLimitUsedBp}
          status={decl.limitStatus}
        />
      </Card>

      <Card className="overflow-hidden">
        {/* The table scrolls inside its card on narrow screens; the page itself never does. */}
        <div
          role="region"
          aria-label={`Declarations ${decl.year}, scrollable`}
          // eslint-disable-next-line jsx-a11y-x/no-noninteractive-tabindex -- keyboard scrolling (WCAG 2.1.1)
          tabIndex={0}
          className="overflow-x-auto outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
        >
          <table className="w-full text-sm">
            <caption className="sr-only">
              Small-business return lines per month of {decl.year}, amounts in GEL
            </caption>
            <thead className="border-b border-line bg-surface-muted text-xs text-fg-muted">
              <tr>
                <th
                  scope="col"
                  className={cx(th, 'sticky start-0 z-10 bg-surface-muted text-start')}
                >
                  Month
                </th>
                <th scope="col" className={cx(th, 'text-start')}>
                  Status
                </th>
                <th scope="col" className={cx(th, 'text-end')}>
                  Income
                </th>
                <th scope="col" className={cx(th, 'text-end')}>
                  Line 15
                  <span className="block font-normal">Cumulative</span>
                </th>
                {PAYMENT_LINES.map((p) => (
                  <th key={p.key} scope="col" className={cx(th, 'text-end')}>
                    Line {p.line}
                    <span className="block font-normal">{p.label}</span>
                  </th>
                ))}
                <th scope="col" className={cx(th, 'text-end')}>
                  Rate
                </th>
                <th scope="col" className={cx(th, 'text-end')}>
                  Tax
                </th>
                <th scope="col" className={cx(th, 'text-start')}>
                  Deadline
                </th>
                {showExcluded ? (
                  <th scope="col" className={cx(th, 'text-end')}>
                    Excluded
                    <span className="block font-normal">Before status</span>
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {decl.months.map((m) => (
                <tr
                  key={m.period}
                  data-period={m.period}
                  className={cx(
                    'border-b border-line last:border-0',
                    !m.filingRequired && 'text-fg-muted',
                  )}
                >
                  <th
                    scope="row"
                    className={cx(th, 'sticky start-0 z-10 bg-surface text-start font-medium')}
                  >
                    <Link
                      href={orgHref(orgId, `/declarations/${m.period}`) as Route}
                      className="text-accent underline-offset-4 hover:underline"
                    >
                      {formatPeriod(m.period)}
                    </Link>
                  </th>
                  <td data-col="return" className="px-2.5 py-2">
                    <ReturnStatus month={m} />
                  </td>
                  <td data-col="income" className={cx(td, 'text-end')}>
                    {amount(m.incomeGelMinor)}
                  </td>
                  <td data-col="line-15" className={cx(td, 'text-end')}>
                    {amount(m.ytdGelMinor)}
                  </td>
                  {PAYMENT_LINES.map((p) => (
                    <td key={p.key} data-col={`line-${p.line}`} className={cx(td, 'text-end')}>
                      {amount(m.byPaymentMethod[p.key])}
                    </td>
                  ))}
                  <td data-col="rate" className={cx(td, 'text-end')}>
                    {formatBp(m.rateBp)}
                  </td>
                  <td data-col="tax" className={cx(td, 'text-end font-medium')}>
                    {amount(m.taxGelMinor)}
                  </td>
                  <td data-col="deadline" className={td}>
                    <time dateTime={m.deadline}>{formatIsoDate(m.deadline)}</time>
                  </td>
                  {showExcluded ? (
                    <td data-col="excluded" className={cx(td, 'text-end')}>
                      {amount(m.excludedGelMinor)}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-line bg-surface-muted font-medium">
              <tr data-period="total">
                <th
                  scope="row"
                  className={cx(th, 'sticky start-0 z-10 bg-surface-muted text-start')}
                >
                  {decl.year} total
                </th>
                <td />
                <td data-col="income" className={cx(td, 'text-end')}>
                  {amount(decl.totalIncomeGelMinor)}
                </td>
                <td colSpan={6} />
                <td data-col="tax" className={cx(td, 'text-end')}>
                  {amount(decl.totalTaxGelMinor)}
                </td>
                <td colSpan={showExcluded ? 2 : 1} />
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>
      <p className="mt-3 text-xs text-fg-muted">
        Cash method: income counts when it is received. Lines 22–24 (accrual method) do not apply.
      </p>
    </PageContainer>
  );
}
