import { toDecimalString } from '@geo-ie-accounting/domain';
import { Badge, Card, PageContainer, PageHeader, cx } from '@geo-ie-accounting/ui';
import { ArrowLeft } from 'lucide-react';
import type { Metadata, Route } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { Notice } from '@/components/Notice';
import type { Schemas } from '@/lib/api/client';
import { serverApi, serverRead } from '@/lib/api/server';
import { canWrite, orgRole } from '@/lib/auth/role';
import {
  formatBp,
  formatIsoDate,
  formatMinor,
  formatPeriod,
  formatTimestamp,
  parseMinor,
} from '@/lib/format';
import { TRANSACTION_SOURCE_LABELS } from '@/lib/labels';
import { orgHref } from '@/lib/nav';
import { FilingStatusBadge, RETURN_LINE_LABELS } from '../../_components/FilingStatusBadge';
import { CopyFigure, FileDeclarationButton, PrintButton } from './PeriodActions';

const LINE_OF = {
  cash_register: 'Line 18',
  pos: 'Line 19',
  bank: 'Line 20',
  other: 'Line 21',
} as const;

const PERIOD = /^[0-9]{4}-(0[1-9]|1[0-2])$/;

export async function generateMetadata({
  params,
}: PageProps<'/o/[orgId]/declarations/[period]'>): Promise<Metadata> {
  const { period } = await params;
  return { title: PERIOD.test(period) ? `Return ${formatPeriod(period)}` : 'Return' };
}

type View = Schemas['DeclarationPeriodView'];

const gelPlain = (minor: string) =>
  toDecimalString({ amountMinor: parseMinor(minor), currency: 'GEL' });
const amount = (minor: string) => formatMinor(minor, 'GEL', { display: 'none' });

/** One return line: number, label, value and a copy button for pasting into rs.ge. */
function Line({
  line,
  label,
  value,
  copy,
  note,
  strong = false,
}: {
  line: string;
  label: string;
  value: ReactNode;
  copy?: string;
  note?: ReactNode;
  strong?: boolean;
}) {
  return (
    <tr data-line={line} className="border-b border-line last:border-0">
      <th scope="row" className="px-3 py-2.5 text-start align-top font-normal">
        <span className="block font-medium">{label}</span>
        {note ? <span className="block text-xs text-fg-muted">{note}</span> : null}
      </th>
      <td
        className={cx(
          'px-3 py-2.5 text-end align-top whitespace-nowrap tabular-nums',
          strong && 'text-base font-semibold',
        )}
      >
        {value}
      </td>
      <td className="w-px px-2 py-1.5 text-end align-top print:hidden">
        {copy !== undefined ? <CopyFigure value={copy} label={label} /> : null}
      </td>
    </tr>
  );
}

function ReturnLines({ view }: { view: View }) {
  const m = view.month;
  const methods = [
    { key: 'cash_register', line: '18', label: 'Line 18', note: 'Cash via cash register' },
    { key: 'pos', line: '19', label: 'Line 19', note: 'POS terminal' },
    { key: 'bank', line: '20', label: 'Line 20', note: 'Received to a bank account' },
    { key: 'other', line: '21', label: 'Line 21', note: 'Other' },
  ] as const;
  return (
    <Card className="overflow-hidden">
      <table className="w-full text-sm">
        <caption className="sr-only">Return lines for {formatPeriod(m.period)}, GEL</caption>
        <tbody>
          <Line
            line="15"
            label="Line 15"
            note="Cumulative income since 1 January"
            value={amount(m.ytdGelMinor)}
            copy={gelPlain(m.ytdGelMinor)}
          />
          {methods.map((p) => (
            <Line
              key={p.key}
              line={p.line}
              label={p.label}
              note={p.note}
              value={amount(m.byPaymentMethod[p.key])}
              copy={gelPlain(m.byPaymentMethod[p.key])}
            />
          ))}
          <Line
            line="rate"
            label="Rate"
            note={
              m.rateBp === view.rules.baseRateBp
                ? 'Base small-business rate'
                : 'Increased rate: the annual limit was crossed this year'
            }
            value={formatBp(m.rateBp)}
          />
          <Line
            line="tax"
            label="Tax due"
            note={`On income of GEL ${amount(m.incomeGelMinor)}`}
            value={`GEL ${amount(m.taxGelMinor)}`}
            copy={gelPlain(m.taxGelMinor)}
            strong
          />
          <Line
            line="deadline"
            label="Deadline"
            note="Return and payment"
            value={<time dateTime={m.deadline}>{formatIsoDate(m.deadline)}</time>}
          />
        </tbody>
      </table>
    </Card>
  );
}

function Drift({ view }: { view: View }) {
  const { status } = view.month;
  if (status.kind !== 'filed_with_drift') return null;
  const changes = view.transactionChanges;
  return (
    <Notice tone="warning" title="The figures changed after filing">
      <p>
        The live figures no longer match the latest filing. If the change is right, file a
        correction on rs.ge and record it here.
      </p>
      <ul className="mt-2 flex flex-col gap-0.5">
        {status.differences.map((d) => (
          <li key={d.line} data-drift={d.line} className="tabular-nums">
            {RETURN_LINE_LABELS[d.line]}:{' '}
            {d.line === 'rate'
              ? `${formatBp(Number(d.filed))} filed, ${formatBp(Number(d.live))} now`
              : `${amount(d.filed)} filed, ${amount(d.live)} now (${formatMinor(d.delta, 'GEL', { display: 'none', signDisplay: 'exceptZero' })})`}
          </li>
        ))}
      </ul>
      {changes && (changes.added.length > 0 || changes.removed.length > 0) ? (
        <p className="mt-2">
          {changes.added.length} transaction{changes.added.length === 1 ? '' : 's'} added,{' '}
          {changes.removed.length} removed since filing.
        </p>
      ) : null}
    </Notice>
  );
}

function Transactions({ view, orgId }: { view: View; orgId: string }) {
  const period = view.month.period;
  const added = new Set(view.transactionChanges?.added ?? []);
  if (view.transactions.length === 0) {
    return (
      <p className="text-sm text-fg-muted">
        No small-business income this month.{' '}
        {view.month.filingRequired ? 'A zero return is still due.' : null}
      </p>
    );
  }
  return (
    <Card className="overflow-hidden">
      <div
        role="region"
        aria-label="Contributing transactions, scrollable"
        // eslint-disable-next-line jsx-a11y-x/no-noninteractive-tabindex -- keyboard scrolling (WCAG 2.1.1)
        tabIndex={0}
        className="overflow-x-auto outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
      >
        <table className="w-full text-sm">
          <caption className="sr-only">
            Transactions behind the {formatPeriod(period)} figures
          </caption>
          <thead className="border-b border-line bg-surface-muted text-xs text-fg-muted">
            <tr>
              <th scope="col" className="px-3 py-2 text-start font-medium">
                Date
              </th>
              <th scope="col" className="px-3 py-2 text-start font-medium">
                Transaction
              </th>
              <th scope="col" className="px-3 py-2 text-start font-medium">
                Line
              </th>
              <th scope="col" className="px-3 py-2 text-end font-medium">
                Original
              </th>
              <th scope="col" className="px-3 py-2 text-end font-medium">
                GEL
              </th>
            </tr>
          </thead>
          <tbody>
            {view.transactions.map((t) => {
              const href = `${orgHref(orgId, '/transactions')}?from=${period}-01&to=${lastDay(period)}&tx=${t.id}`;
              return (
                <tr
                  key={t.id}
                  data-transaction={t.id}
                  className={cx(
                    'border-b border-line last:border-0',
                    t.excluded && 'text-fg-muted',
                  )}
                >
                  <td className="px-3 py-2 whitespace-nowrap">
                    <time dateTime={t.occurredOn}>{formatIsoDate(t.occurredOn)}</time>
                  </td>
                  <td className="px-3 py-2">
                    <Link
                      href={href as Route}
                      className="font-medium text-accent underline-offset-4 hover:underline"
                    >
                      {t.counterparty ?? t.description}
                    </Link>
                    <span className="mt-0.5 flex flex-wrap gap-1">
                      {t.source === 'reversal' ? (
                        <Badge tone="warning">{TRANSACTION_SOURCE_LABELS.reversal}</Badge>
                      ) : null}
                      {t.excluded ? <Badge>Before status start, not declared</Badge> : null}
                      {added.has(t.id) ? <Badge tone="info">Added after filing</Badge> : null}
                    </span>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-fg-muted">
                    {t.paymentMethod ? LINE_OF[t.paymentMethod] : '–'}
                  </td>
                  <td className="px-3 py-2 text-end whitespace-nowrap tabular-nums">
                    {formatMinor(t.amountMinor, t.currency)}
                  </td>
                  <td className="px-3 py-2 text-end whitespace-nowrap tabular-nums">
                    {amount(t.incomeGelMinor)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/** Last calendar day of `YYYY-MM`, for the transactions filter. */
function lastDay(period: string): string {
  const [y, m] = period.split('-').map(Number);
  const day = new Date(Date.UTC(y ?? 2000, m ?? 1, 0)).getUTCDate();
  return `${period}-${String(day).padStart(2, '0')}`;
}

function History({ view }: { view: View }) {
  if (view.filings.length === 0) {
    return <p className="text-sm text-fg-muted">Not filed yet.</p>;
  }
  return (
    <ol className="flex flex-col gap-2">
      {view.filings.map((f, i) => (
        <li key={f.id} data-filing-version={f.version}>
          <Card className="flex flex-col gap-1 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-0.5">
              <p className="flex flex-wrap items-center gap-2 font-medium">
                {f.version === 1 ? 'Original return' : `Correction ${f.version - 1}`}
                {i === 0 ? <Badge tone="accent">Latest</Badge> : <Badge>Superseded</Badge>}
                {f.zeroReturn ? <Badge tone="info">Zero return</Badge> : null}
              </p>
              <p className="text-fg-muted">
                {formatTimestamp(f.filedAt)} by {f.filedBy.name}
                {f.rsReference ? `, rs.ge reference ${f.rsReference}` : ''}
              </p>
            </div>
            <p className="text-fg-muted tabular-nums">
              Line 15 {amount(f.figures.ytdGelMinor)} · tax {amount(f.figures.taxGelMinor)} at{' '}
              {formatBp(f.figures.rateBp)}
            </p>
          </Card>
        </li>
      ))}
    </ol>
  );
}

export default async function DeclarationPeriodPage({
  params,
}: PageProps<'/o/[orgId]/declarations/[period]'>) {
  const { orgId, period } = await params;
  if (!PERIOD.test(period)) notFound();
  const api = await serverApi();
  const [view, role] = await Promise.all([
    serverRead(
      api.GET('/v1/orgs/{orgId}/declarations/{period}', {
        params: { path: { orgId, period } },
      }),
      orgHref(orgId, `/declarations/${period}`),
    ),
    orgRole(orgId),
  ]);
  const m = view.month;
  const label = formatPeriod(period);
  const year = period.slice(0, 4);
  const latest = view.filings[0] ?? null;

  return (
    <PageContainer className="print:max-w-none print:p-0">
      <Link
        href={orgHref(orgId, `/declarations?year=${year}`) as Route}
        className="mb-3 inline-flex items-center gap-1 text-sm text-fg-muted hover:text-fg print:hidden"
      >
        <ArrowLeft aria-hidden className="size-4" />
        Declarations {year}
      </Link>
      <PageHeader
        title={`Return for ${label}`}
        description={`Small-business monthly return, cash method. Rules of ${formatIsoDate(view.rules.version)}. Figures as of ${formatIsoDate(view.today)}.`}
        actions={
          <>
            <PrintButton />
            {canWrite(role) && view.fileBlocker === null ? (
              <FileDeclarationButton
                orgId={orgId}
                period={period}
                periodLabel={label}
                latestFilingId={latest?.id ?? null}
                hasDrift={m.status.kind === 'filed_with_drift'}
                zeroReturn={m.zeroReturn}
              />
            ) : null}
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <FilingStatusBadge status={m.status} zeroReturn={m.zeroReturn} />
        {m.zeroReturn && m.filingRequired ? <Badge tone="info">Zero return</Badge> : null}
        {m.sbsStatus === 'partial' ? <Badge tone="warning">Status from mid-month</Badge> : null}
        {m.limitCrossedThisMonth ? <Badge tone="negative">Limit crossed this month</Badge> : null}
        {m.negativeIncome ? <Badge tone="negative">Reversals exceed income</Badge> : null}
      </div>

      <div className="mb-6 flex flex-col gap-3">
        <Drift view={view} />
        {view.fileBlocker === 'not_required' ? (
          <Notice tone="info" title="No return for this month">
            The small-business status does not cover {label}
            {view.sbsEffectiveFrom ? ` (it starts ${formatIsoDate(view.sbsEffectiveFrom)})` : ''}.
          </Notice>
        ) : null}
        {view.fileBlocker === 'period_open' ? (
          <Notice tone="info" title="The month is not over yet">
            The figures can still change. The return can be filed from the 1st of next month.
          </Notice>
        ) : null}
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] print:block">
        <section aria-labelledby="lines-heading" className="flex flex-col gap-3">
          <h2 id="lines-heading" className="text-base font-semibold">
            Return lines
          </h2>
          <ReturnLines view={view} />
          <p className="text-xs text-fg-muted print:hidden">
            Copy gives the plain figure (e.g. 1234.56) to paste into the rs.ge form. Lines 22–24
            (accrual method) do not apply.
          </p>
        </section>

        <div className="flex flex-col gap-6 print:mt-6">
          <section aria-labelledby="tx-heading" className="flex flex-col gap-3">
            <h2 id="tx-heading" className="text-base font-semibold">
              Contributing transactions
            </h2>
            <Transactions view={view} orgId={orgId} />
          </section>
          <section aria-labelledby="history-heading" className="flex flex-col gap-3">
            <h2 id="history-heading" className="text-base font-semibold">
              Filing history
            </h2>
            <History view={view} />
          </section>
        </div>
      </div>
    </PageContainer>
  );
}
