import {
  ButtonLink,
  Card,
  EmptyState,
  PageContainer,
  PageHeader,
  Skeleton,
  SkeletonText,
} from '@ie-ledger/ui';
import { Upload } from 'lucide-react';
import type { Metadata, Route } from 'next';
import Link from 'next/link';
import { Suspense, type ReactNode } from 'react';
import { Notice } from '@/components/Notice';
import type { Schemas } from '@/lib/api/client';
import { serverApi, serverRead } from '@/lib/api/server';
import { formatBp, formatIsoDate, formatMinor, formatPeriod, parseMinor } from '@/lib/format';
import { orgHref } from '@/lib/nav';
import { parseYearParam, yearOptions } from '@/lib/years';
import { BarList, MonthlyIncomeChart } from './_components/charts';
import { FilingStatusBadge } from './_components/FilingStatusBadge';
import { LimitMeter } from './_components/LimitMeter';
import { YearPicker } from './_components/YearPicker';

export const metadata: Metadata = { title: 'Dashboard' };

type Dashboard = Schemas['DashboardView'];
type DashboardPromise = Promise<Dashboard>;

// Every widget awaits the same request inside its own Suspense boundary: the page shell
// streams at once and each widget fills in as the data arrives. The figures come from one
// aggregated endpoint, so one request feeds them all.

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

function WidgetSkeleton({ title }: { title: string }) {
  return (
    <Widget title={title}>
      <Skeleton className="h-8 w-2/3" />
      <SkeletonText lines={1} />
    </Widget>
  );
}

function Figure({ children }: { children: ReactNode }) {
  return <p className="text-2xl font-semibold tracking-tight tabular-nums">{children}</p>;
}

const link = 'font-medium text-accent underline-offset-4 hover:underline';

async function HeaderActions({ data, orgId }: { data: DashboardPromise; orgId: string }) {
  const dash = await data;
  return (
    <>
      <YearPicker year={dash.year} years={yearOptions(dash.year, dash.sbsEffectiveFrom)} />
      <ButtonLink href={orgHref(orgId, '/imports')} variant="secondary">
        <Upload aria-hidden />
        Import statement
      </ButtonLink>
    </>
  );
}

async function Description({ data }: { data: DashboardPromise }) {
  const dash = await data;
  return <>Small-business figures for {dash.year}.</>;
}

async function NoStatusNotice({ data, orgId }: { data: DashboardPromise; orgId: string }) {
  const dash = await data;
  if (dash.sbsEffectiveFrom !== null) return null;
  return (
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
  );
}

async function YtdWidget({ data }: { data: DashboardPromise }) {
  const dash = await data;
  return (
    <Widget
      title={`SBS income, ${dash.year} to date`}
      footer={`Return line 15${dash.sbsEffectiveFrom ? `, status since ${formatIsoDate(dash.sbsEffectiveFrom)}` : ''}`}
    >
      <Figure>{formatMinor(dash.ytdIncomeGelMinor, 'GEL')}</Figure>
    </Widget>
  );
}

async function LatestMonthWidget({ data, orgId }: { data: DashboardPromise; orgId: string }) {
  const dash = await data;
  const latest = dash.latestMonth;
  return (
    <Widget
      title="Latest month"
      footer={
        latest ? (
          <Link href={orgHref(orgId, `/declarations/${latest.period}`) as Route} className={link}>
            See the return
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
  );
}

async function NextReturnWidget({ data, orgId }: { data: DashboardPromise; orgId: string }) {
  const dash = await data;
  const next = dash.nextReturn;
  const overdue = dash.statusCounts.overdue ?? 0;
  return (
    <Widget
      title="Next return"
      footer={
        next ? (
          <Link href={orgHref(orgId, `/declarations/${next.period}`) as Route} className={link}>
            Open the {formatPeriod(next.period)} return
          </Link>
        ) : undefined
      }
    >
      {next ? (
        <>
          <Figure>
            <time dateTime={next.deadline}>{formatIsoDate(next.deadline)}</time>
          </Figure>
          <p className="text-sm text-fg-muted">
            {formatPeriod(next.period)} return,{' '}
            {next.zeroReturn ? 'zero return' : `tax ${formatMinor(next.taxGelMinor, 'GEL')}`}
          </p>
          <span className="flex flex-wrap gap-1">
            <FilingStatusBadge status={next.status} zeroReturn={next.zeroReturn} />
          </span>
          {overdue > 1 ? (
            <p className="text-xs text-negative-fg">
              {overdue} returns of {dash.year} are overdue.
            </p>
          ) : null}
        </>
      ) : (
        <p className="text-sm text-fg-muted">No return due for {dash.year}.</p>
      )}
    </Widget>
  );
}

async function LimitWidget({ data }: { data: DashboardPromise }) {
  const dash = await data;
  return (
    <Widget title="Annual limit">
      <LimitMeter
        ytdGelMinor={dash.ytdIncomeGelMinor}
        limitGelMinor={dash.annualLimitGelMinor}
        usedBp={dash.annualLimitUsedBp}
        status={dash.limitStatus}
      />
    </Widget>
  );
}

async function MonthlyIncome({ data, orgId }: { data: DashboardPromise; orgId: string }) {
  const dash = await data;
  const hasIncome = dash.months.some((m) => parseMinor(m.incomeGelMinor) !== 0n);
  if (!hasIncome) {
    return (
      <EmptyState
        icon={<Upload />}
        title={`No small-business income in ${dash.year} yet`}
        description="Import a bank statement and its incoming payments show up here."
        actions={<ButtonLink href={orgHref(orgId, '/imports')}>Import a statement</ButtonLink>}
      />
    );
  }
  return (
    <Card className="flex flex-col gap-3 p-4 sm:p-5">
      <MonthlyIncomeChart months={dash.months} />
      <details>
        <summary className="cursor-pointer text-sm text-fg-muted">Show as a table</summary>
        <table className="mt-2 w-full text-sm">
          <caption className="sr-only">SBS income and tax by month of {dash.year}, GEL</caption>
          <thead className="border-b border-line text-xs text-fg-muted">
            <tr>
              <th scope="col" className="px-2 py-1.5 text-start font-medium">
                Month
              </th>
              <th scope="col" className="px-2 py-1.5 text-end font-medium">
                SBS income
              </th>
              <th scope="col" className="px-2 py-1.5 text-end font-medium">
                Tax
              </th>
            </tr>
          </thead>
          <tbody>
            {dash.months.map((m) => (
              <tr key={m.period} className="border-b border-line last:border-0">
                <th scope="row" className="px-2 py-1.5 text-start font-normal">
                  {formatPeriod(m.period)}
                </th>
                <td className="px-2 py-1.5 text-end tabular-nums">
                  {formatMinor(m.incomeGelMinor, 'GEL', { display: 'none' })}
                </td>
                <td className="px-2 py-1.5 text-end tabular-nums">
                  {formatMinor(m.taxGelMinor, 'GEL', { display: 'none' })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </Card>
  );
}

async function CounterpartyWidget({ data }: { data: DashboardPromise }) {
  const dash = await data;
  const { top, other } = dash.byCounterparty;
  const items = top.map((c, i) => ({
    key: `${i}-${c.counterparty ?? ''}`,
    label: c.counterparty ?? 'No counterparty',
    valueMinor: c.incomeGelMinor,
    muted: c.counterparty === null,
  }));
  if (other.counterpartyCount > 0) {
    items.push({
      key: 'other',
      label: `Other (${other.counterpartyCount})`,
      valueMinor: other.incomeGelMinor,
      muted: true,
    });
  }
  return (
    <Widget title="Income by counterparty" footer="Top 5 by SBS income in GEL, the rest summed.">
      {items.length > 0 ? (
        <BarList items={items} label={`SBS income by counterparty, ${dash.year}`} />
      ) : (
        <p className="text-sm text-fg-muted">No small-business income in {dash.year}.</p>
      )}
    </Widget>
  );
}

async function CurrencyWidget({ data }: { data: DashboardPromise }) {
  const dash = await data;
  const items = dash.currencyMix.map((c) => ({
    key: c.currency,
    label: c.currency,
    valueMinor: c.incomeGelMinor,
    detail:
      c.currency === 'GEL'
        ? `${c.transactionCount} transactions`
        : `${formatMinor(c.amountMinor, c.currency)} in ${c.transactionCount} transactions`,
  }));
  return (
    <Widget title="Currency mix" footer="SBS income by the currency it was received in, at GEL.">
      {items.length > 0 ? (
        <BarList items={items} label={`SBS income by currency, ${dash.year}`} />
      ) : (
        <p className="text-sm text-fg-muted">No small-business income in {dash.year}.</p>
      )}
    </Widget>
  );
}

export default async function DashboardPage({ params, searchParams }: PageProps<'/o/[orgId]'>) {
  const { orgId } = await params;
  const year = parseYearParam((await searchParams).year);
  const api = await serverApi();
  // Not awaited here: each widget awaits it under its own Suspense boundary.
  const data = serverRead(
    api.GET('/v1/orgs/{orgId}/dashboard', {
      params: { path: { orgId }, query: year ? { year } : {} },
    }),
    orgHref(orgId),
  );

  return (
    <PageContainer>
      <PageHeader
        title="Dashboard"
        description={
          <Suspense fallback="Small-business figures.">
            <Description data={data} />
          </Suspense>
        }
        actions={
          <Suspense fallback={<Skeleton className="h-10 w-48" />}>
            <HeaderActions data={data} orgId={orgId} />
          </Suspense>
        }
      />

      <Suspense fallback={null}>
        <NoStatusNotice data={data} orgId={orgId} />
      </Suspense>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Suspense fallback={<WidgetSkeleton title="SBS income to date" />}>
          <YtdWidget data={data} />
        </Suspense>
        <Suspense fallback={<WidgetSkeleton title="Latest month" />}>
          <LatestMonthWidget data={data} orgId={orgId} />
        </Suspense>
        <Suspense fallback={<WidgetSkeleton title="Next return" />}>
          <NextReturnWidget data={data} orgId={orgId} />
        </Suspense>
        <Suspense fallback={<WidgetSkeleton title="Annual limit" />}>
          <LimitWidget data={data} />
        </Suspense>
      </div>

      <section aria-labelledby="months-heading" className="mt-8">
        <h2 id="months-heading" className="mb-3 text-base font-semibold">
          Income by month
        </h2>
        <Suspense fallback={<Skeleton className="h-56 w-full" />}>
          <MonthlyIncome data={data} orgId={orgId} />
        </Suspense>
      </section>

      <div className="mt-8 grid gap-4 lg:grid-cols-2">
        <Suspense fallback={<WidgetSkeleton title="Income by counterparty" />}>
          <CounterpartyWidget data={data} />
        </Suspense>
        <Suspense fallback={<WidgetSkeleton title="Currency mix" />}>
          <CurrencyWidget data={data} />
        </Suspense>
      </div>
    </PageContainer>
  );
}
