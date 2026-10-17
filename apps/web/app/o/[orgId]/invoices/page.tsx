import { INVOICE_LIST_FILTERS, type InvoiceListFilter } from '@geo-ie-accounting/contracts';
import { ButtonLink, Card, cx, EmptyState, PageContainer, PageHeader } from '@geo-ie-accounting/ui';
import { FileText, Plus } from 'lucide-react';
import type { Metadata, Route } from 'next';
import Link from 'next/link';
import { Amount } from '@/components/Amount';
import { serverApi, serverRead } from '@/lib/api/server';
import { canWrite, orgRole } from '@/lib/auth/role';
import { orgHref } from '@/lib/nav';
import { InvoiceTable } from './_components/InvoiceTable';

export const metadata: Metadata = { title: 'Invoices' };

const FILTER_LABELS: Record<InvoiceListFilter, string> = {
  draft: 'Drafts',
  issued: 'Issued',
  overdue: 'Overdue',
  paid: 'Paid',
  void: 'Void',
};

const PAGE = 50;

function parseStatus(value: string | string[] | undefined): InvoiceListFilter | undefined {
  return typeof value === 'string' && (INVOICE_LIST_FILTERS as readonly string[]).includes(value)
    ? (value as InvoiceListFilter)
    : undefined;
}

/** `?status=` filters the list (overdue: issued and past due); `?cursor=` pages back. */
export default async function InvoicesPage({
  params,
  searchParams,
}: PageProps<'/o/[orgId]/invoices'>) {
  const { orgId } = await params;
  const query = await searchParams;
  const status = parseStatus(query.status);
  const cursor = typeof query.cursor === 'string' ? query.cursor : undefined;
  const path = orgHref(orgId, '/invoices');
  const api = await serverApi();
  const [list, summary, role] = await Promise.all([
    serverRead(
      api.GET('/v1/orgs/{orgId}/invoices', {
        params: {
          path: { orgId },
          query: { limit: PAGE, ...(status ? { status } : {}), ...(cursor ? { cursor } : {}) },
        },
      }),
      path,
    ),
    serverRead(api.GET('/v1/orgs/{orgId}/invoices/summary', { params: { path: { orgId } } }), path),
    orgRole(orgId),
  ]);
  const writable = canWrite(role);
  const filterHref = (s?: InvoiceListFilter) => (s ? `${path}?status=${s}` : path) as Route;

  return (
    <PageContainer>
      <PageHeader
        title="Invoices"
        description="Invoices to your clients and what they still owe. Income still comes from your bank statements."
        actions={
          writable ? (
            <ButtonLink href={orgHref(orgId, '/invoices/new')}>
              <Plus aria-hidden />
              New invoice
            </ButtonLink>
          ) : undefined
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2">
        <Card className="flex flex-col gap-1 p-4 sm:p-5">
          <h2 className="text-sm font-medium text-fg-muted">Outstanding</h2>
          {summary.byCurrency.length === 0 ? (
            <p className="text-2xl font-semibold tracking-tight">Nothing owed</p>
          ) : (
            summary.byCurrency.map((c) => (
              <p key={c.currency} className="text-2xl font-semibold tracking-tight">
                <Amount minor={c.outstandingMinor} currency={c.currency} />
              </p>
            ))
          )}
          <p className="text-xs text-fg-muted">
            {summary.outstandingCount} issued{' '}
            {summary.outstandingCount === 1 ? 'invoice' : 'invoices'} not yet paid
          </p>
        </Card>
        <Card className="flex flex-col gap-1 p-4 sm:p-5">
          <h2 className="text-sm font-medium text-fg-muted">Overdue</h2>
          {summary.overdueCount === 0 ? (
            <p className="text-2xl font-semibold tracking-tight">None</p>
          ) : (
            summary.byCurrency
              .filter((c) => c.overdueCount > 0)
              .map((c) => (
                <p
                  key={c.currency}
                  className="text-2xl font-semibold tracking-tight text-negative-fg"
                >
                  <Amount minor={c.overdueMinor} currency={c.currency} />
                </p>
              ))
          )}
          <p className="text-xs text-fg-muted">
            {summary.overdueCount} past the due date
            {summary.draftCount > 0 ? ` · ${summary.draftCount} drafts` : ''}
          </p>
        </Card>
      </div>

      <nav aria-label="Filter by status" className="mb-4 flex flex-wrap gap-2">
        {[undefined, ...INVOICE_LIST_FILTERS].map((s) => {
          const active = s === status;
          return (
            <Link
              key={s ?? 'all'}
              href={filterHref(s)}
              aria-current={active ? 'page' : undefined}
              className={cx(
                'rounded-full border px-3 py-1 text-sm',
                active
                  ? 'border-accent bg-accent-soft font-medium text-accent-soft-fg'
                  : 'border-line text-fg-muted hover:bg-surface-muted',
              )}
            >
              {s ? FILTER_LABELS[s] : 'All'}
            </Link>
          );
        })}
      </nav>

      {list.items.length === 0 ? (
        <EmptyState
          icon={<FileText />}
          title={status ? `No ${FILTER_LABELS[status].toLowerCase()} invoices` : 'No invoices yet'}
          description={
            status ? 'Try another filter.' : 'Create a draft, issue it and download the PDF.'
          }
          actions={
            writable && !status ? (
              <ButtonLink href={orgHref(orgId, '/invoices/new')}>New invoice</ButtonLink>
            ) : undefined
          }
        />
      ) : (
        <InvoiceTable orgId={orgId} invoices={list.items} caption="Invoices, newest first" />
      )}
      {list.nextCursor ? (
        <div className="mt-4 flex justify-center">
          <ButtonLink
            variant="secondary"
            href={
              `${path}?${new URLSearchParams({
                ...(status ? { status } : {}),
                cursor: list.nextCursor,
              }).toString()}` as Route
            }
          >
            Older invoices
          </ButtonLink>
        </div>
      ) : null}
    </PageContainer>
  );
}
