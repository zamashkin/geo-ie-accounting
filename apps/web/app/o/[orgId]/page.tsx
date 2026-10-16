import { Badge, ButtonLink, Card, EmptyState, PageContainer, PageHeader } from '@ie-ledger/ui';
import { Upload } from 'lucide-react';
import type { Metadata, Route } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Notice } from '@/components/Notice';
import { serverApi, serverRead } from '@/lib/api/server';
import { formatBp, formatIsoDate, formatMinor, formatPeriod, parseMinor } from '@/lib/format';
import { orgHref } from '@/lib/nav';
import { parseYearParam, yearOptions } from '@/lib/years';
import { LimitMeter } from './_components/LimitMeter';
import { YearPicker } from './_components/YearPicker';

export const metadata: Metadata = { title: 'Dashboard' };

function Widget({
  title,
  children,
  footer,
}: {
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <Card className="flex flex-col gap-2 p-4 sm:p-5">
      <h2 className="text-sm font-medium text-fg-muted">{title}</h2>
      <div className="flex flex-1 flex-col gap-1">{children}</div>
      {footer ? <div className="text-xs text-fg-muted">{footer}</div> : null}
    </Card>
  );
}

function Figure({ children }: { children: ReactNode }) {
  return <p className="text-2xl font-semibold tracking-tight tabular-nums">{children}</p>;
}

export default async function DashboardPage({ params, searchParams }: PageProps<'/o/[orgId]'>) {
  const { orgId } = await params;
  const year = parseYearParam((await searchParams).year);
  const api = await serverApi();
  const dash = await serverRead(
    api.GET('/v1/orgs/{orgId}/dashboard', {
      params: { path: { orgId }, query: year ? { year } : {} },
    }),
    orgHref(orgId),
  );

  const latest = dash.latestMonth;
  const next = dash.nextDeadline;
  const hasIncome = dash.months.some((m) => parseMinor(m.incomeGelMinor) !== 0n);
  const maxIncome = dash.months.reduce((max, m) => {
    const v = parseMinor(m.incomeGelMinor);
    return v > max ? v : max;
  }, 0n);

  return (
    <PageContainer>
      <PageHeader
        title="Dashboard"
        description={`Small-business figures for ${dash.year}.`}
        actions={
          <>
            <YearPicker year={dash.year} years={yearOptions(dash.year, dash.sbsEffectiveFrom)} />
            <ButtonLink href={orgHref(orgId, '/imports')} variant="secondary">
              <Upload aria-hidden />
              Import statement
            </ButtonLink>
          </>
        }
      />

      {dash.sbsEffectiveFrom === null ? (
        <Notice
          tone="warning"
          title="No small-business status start date"
          className="mb-6"
          actions={
            <ButtonLink href={orgHref(orgId, '/settings')} size="sm" variant="secondary">
              Set the date
            </ButtonLink>
          }
        >
          Without it nothing counts as small-business income and no return is computed.
        </Notice>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Widget
          title={`SBS income, ${dash.year} to date`}
          footer={`Return line 15${dash.sbsEffectiveFrom ? `, status since ${formatIsoDate(dash.sbsEffectiveFrom)}` : ''}`}
        >
          <Figure>{formatMinor(dash.ytdIncomeGelMinor, 'GEL')}</Figure>
        </Widget>

        <Widget
          title="Latest month"
          footer={
            latest ? (
              <Link
                href={orgHref(orgId, `/declarations?year=${dash.year}`) as Route}
                className="font-medium text-accent underline-offset-4 hover:underline"
              >
                See the declaration
              </Link>
            ) : undefined
          }
        >
          {latest ? (
            <>
              <p className="text-sm font-medium">{formatPeriod(latest.period)}</p>
              <Figure>{formatMinor(latest.taxGelMinor, 'GEL')}</Figure>
              <p className="text-sm text-fg-muted tabular-nums">
                Tax at {formatBp(latest.rateBp)} on {formatMinor(latest.incomeGelMinor, 'GEL')}
              </p>
            </>
          ) : (
            <p className="text-sm text-fg-muted">No small-business income in {dash.year}.</p>
          )}
        </Widget>

        <Widget title="Next deadline">
          {next ? (
            <>
              <Figure>{formatIsoDate(next.deadline)}</Figure>
              <p className="text-sm text-fg-muted">
                {formatPeriod(next.period)} return,{' '}
                {next.zeroReturn ? 'zero return' : `tax ${formatMinor(next.taxGelMinor, 'GEL')}`}
              </p>
              {next.zeroReturn ? (
                <Badge tone="info" className="self-start">
                  Zero return
                </Badge>
              ) : null}
            </>
          ) : (
            <p className="text-sm text-fg-muted">No return due for {dash.year} from today on.</p>
          )}
        </Widget>

        <Widget title="Annual limit">
          <LimitMeter
            ytdGelMinor={dash.ytdIncomeGelMinor}
            limitGelMinor={dash.annualLimitGelMinor}
            usedBp={dash.annualLimitUsedBp}
            status={dash.limitStatus}
          />
        </Widget>
      </div>

      <section aria-labelledby="months-heading" className="mt-8">
        <h2 id="months-heading" className="mb-3 text-base font-semibold">
          Income by month
        </h2>
        {hasIncome ? (
          <Card className="overflow-hidden">
            <table className="w-full text-sm">
              <thead className="border-b border-line bg-surface-muted text-xs text-fg-muted">
                <tr>
                  <th scope="col" className="px-3 py-2 text-start font-medium">
                    Month
                  </th>
                  <th scope="col" className="px-3 py-2 text-end font-medium">
                    SBS income
                  </th>
                  <th scope="col" className="hidden w-1/3 px-3 py-2 font-medium sm:table-cell">
                    <span className="sr-only">Share of the year’s best month</span>
                  </th>
                  <th scope="col" className="px-3 py-2 text-end font-medium">
                    Tax
                  </th>
                </tr>
              </thead>
              <tbody>
                {dash.months.map((m) => {
                  const income = parseMinor(m.incomeGelMinor);
                  const pct = maxIncome > 0n && income > 0n ? (income * 100n) / maxIncome : 0n;
                  return (
                    <tr key={m.period} className="border-b border-line last:border-0">
                      <th scope="row" className="px-3 py-2 text-start font-normal">
                        {formatPeriod(m.period)}
                      </th>
                      <td className="px-3 py-2 text-end tabular-nums">
                        {formatMinor(m.incomeGelMinor, 'GEL', { display: 'none' })}
                      </td>
                      <td aria-hidden className="hidden px-3 py-2 sm:table-cell">
                        <div
                          className="h-2 rounded-full bg-accent/70"
                          style={{ width: `${pct.toString()}%` }}
                        />
                      </td>
                      <td className="px-3 py-2 text-end tabular-nums">
                        {formatMinor(m.taxGelMinor, 'GEL', { display: 'none' })}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        ) : (
          <EmptyState
            icon={<Upload />}
            title={`No small-business income in ${dash.year} yet`}
            description="Import a bank statement and its incoming payments show up here."
            actions={<ButtonLink href={orgHref(orgId, '/imports')}>Import a statement</ButtonLink>}
          />
        )}
      </section>
    </PageContainer>
  );
}
