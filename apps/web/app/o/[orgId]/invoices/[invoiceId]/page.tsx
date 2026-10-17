import { Card, PageContainer, PageHeader } from '@geo-ie-accounting/ui';
import type { Metadata, Route } from 'next';
import Link from 'next/link';
import { Amount } from '@/components/Amount';
import type { Schemas } from '@/lib/api/client';
import { serverApi, serverRead } from '@/lib/api/server';
import { canWrite, orgRole } from '@/lib/auth/role';
import { formatIsoDate, formatTimestamp } from '@/lib/format';
import { orgHref } from '@/lib/nav';
import { InvoiceStatusBadge } from '../../_components/InvoiceStatusBadge';
import { InvoiceEditor } from '../InvoiceEditor';
import { InvoiceActions, PaymentList } from './InvoiceActions';

export const metadata: Metadata = { title: 'Invoice' };

type Party = Schemas['InvoiceParty'];

function PartyCard({ title, party }: { title: string; party: Party }) {
  return (
    <Card className="flex flex-col gap-1 p-4 sm:p-5">
      <h2 className="text-xs font-medium tracking-wide text-fg-muted uppercase">{title}</h2>
      <p className="font-medium">{party.name}</p>
      {[party.address, party.taxId ? `Tax ID ${party.taxId}` : null, party.email, party.phone]
        .filter((v): v is string => Boolean(v))
        .map((v) => (
          <p key={v} className="text-sm whitespace-pre-line text-fg-muted">
            {v}
          </p>
        ))}
    </Card>
  );
}

export default async function InvoicePage({
  params,
}: PageProps<'/o/[orgId]/invoices/[invoiceId]'>) {
  const { orgId, invoiceId } = await params;
  const path = orgHref(orgId, `/invoices/${invoiceId}`);
  const api = await serverApi();
  const [invoice, role] = await Promise.all([
    serverRead(
      api.GET('/v1/orgs/{orgId}/invoices/{invoiceId}', { params: { path: { orgId, invoiceId } } }),
      path,
    ),
    orgRole(orgId),
  ]);
  const writable = canWrite(role);

  if (invoice.status === 'draft' && writable) {
    const [clients, accounts] = await Promise.all([
      serverRead(
        api.GET('/v1/orgs/{orgId}/clients', {
          params: { path: { orgId }, query: { includeArchived: 'true' } },
        }),
        path,
      ),
      serverRead(api.GET('/v1/orgs/{orgId}/accounts', { params: { path: { orgId } } }), path),
    ]);
    return (
      <PageContainer className="max-w-5xl">
        <PageHeader
          title="Draft invoice"
          description={`For ${invoice.clientName}. Edit it freely until you issue it.`}
        />
        <InvoiceEditor
          key={invoice.updatedAt}
          orgId={orgId}
          invoice={invoice}
          clients={clients.items}
          accounts={accounts.items}
        />
      </PageContainer>
    );
  }

  const { seller, client, bank } = invoice.parties;
  return (
    <PageContainer className="max-w-5xl">
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            {invoice.number ? `Invoice ${invoice.number}` : 'Draft invoice'}
            <InvoiceStatusBadge status={invoice.status} overdue={invoice.overdue} />
          </span>
        }
        description={
          <>
            For{' '}
            <Link
              href={orgHref(orgId, `/clients/${invoice.clientId}`) as Route}
              className="underline underline-offset-4"
            >
              {invoice.clientName}
            </Link>
            {invoice.issuedAt ? `, issued ${formatTimestamp(invoice.issuedAt)}` : ''}
          </>
        }
        actions={<InvoiceActions orgId={orgId} invoice={invoice} canWrite={writable} />}
      />

      <div className="grid gap-4 md:grid-cols-3">
        <PartyCard title="From" party={seller} />
        <PartyCard title="Bill to" party={client} />
        <Card className="flex flex-col gap-2 p-4 text-sm sm:p-5">
          <div className="flex justify-between gap-2">
            <span className="text-fg-muted">Issue date</span>
            <span>{invoice.issueDate ? formatIsoDate(invoice.issueDate) : '—'}</span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-fg-muted">Due date</span>
            <span className={invoice.overdue ? 'font-medium text-negative-fg' : undefined}>
              {invoice.dueDate ? formatIsoDate(invoice.dueDate) : '—'}
            </span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-fg-muted">Pay to</span>
            <span className="text-end font-mono text-xs break-all">{bank?.iban ?? '—'}</span>
          </div>
        </Card>
      </div>

      <section aria-labelledby="lines-heading" className="mt-6">
        <h2 id="lines-heading" className="mb-3 text-base font-semibold">
          Lines
        </h2>
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full text-sm">
            <thead className="border-b border-line text-xs text-fg-muted">
              <tr>
                <th scope="col" className="px-3 py-2 text-start font-medium">
                  Description
                </th>
                <th scope="col" className="px-3 py-2 text-end font-medium">
                  Qty
                </th>
                <th scope="col" className="px-3 py-2 text-end font-medium">
                  Unit price
                </th>
                <th scope="col" className="px-3 py-2 text-end font-medium">
                  Amount
                </th>
              </tr>
            </thead>
            <tbody>
              {invoice.lines.map((l) => (
                <tr key={l.id} className="border-b border-line last:border-0">
                  <td className="px-3 py-2">{l.description}</td>
                  <td className="px-3 py-2 text-end tabular-nums">{l.quantity}</td>
                  <td className="px-3 py-2 text-end">
                    <Amount minor={l.unitPriceMinor} currency={invoice.currency} display="none" />
                  </td>
                  <td className="px-3 py-2 text-end">
                    <Amount minor={l.lineTotalMinor} currency={invoice.currency} display="none" />
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-line-strong">
              <tr>
                <th scope="row" colSpan={3} className="px-3 py-2 text-end font-medium">
                  Total
                </th>
                <td className="px-3 py-2 text-end font-semibold">
                  <Amount minor={invoice.totalMinor} currency={invoice.currency} />
                </td>
              </tr>
              {invoice.status === 'issued' || invoice.status === 'paid' ? (
                <tr>
                  <th scope="row" colSpan={3} className="px-3 py-2 text-end font-medium">
                    Outstanding
                  </th>
                  <td className="px-3 py-2 text-end">
                    <Amount minor={invoice.outstandingMinor} currency={invoice.currency} />
                  </td>
                </tr>
              ) : null}
            </tfoot>
          </table>
        </div>
        {invoice.notes ? (
          <p className="mt-3 text-sm whitespace-pre-line text-fg-muted">{invoice.notes}</p>
        ) : null}
      </section>

      {invoice.status !== 'draft' && invoice.status !== 'void' ? (
        <section aria-labelledby="payments-heading" className="mt-8">
          <h2 id="payments-heading" className="mb-3 text-base font-semibold">
            Payments
          </h2>
          <PaymentList orgId={orgId} invoice={invoice} canWrite={writable} />
        </section>
      ) : null}
    </PageContainer>
  );
}
