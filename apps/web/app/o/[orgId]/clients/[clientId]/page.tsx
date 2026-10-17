import { Card, EmptyState, PageContainer, PageHeader } from '@ie-ledger/ui';
import { FileText } from 'lucide-react';
import type { Metadata } from 'next';
import { Amount } from '@/components/Amount';
import { serverApi, serverRead } from '@/lib/api/server';
import { canWrite, orgRole } from '@/lib/auth/role';
import { orgHref } from '@/lib/nav';
import { InvoiceTable } from '../../invoices/_components/InvoiceTable';
import { ClientActions } from './ClientActions';

export const metadata: Metadata = { title: 'Client' };

function Detail({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-xs text-fg-muted">{label}</dt>
      <dd className="text-sm break-words whitespace-pre-line">{value ?? '—'}</dd>
    </div>
  );
}

export default async function ClientPage({ params }: PageProps<'/o/[orgId]/clients/[clientId]'>) {
  const { orgId, clientId } = await params;
  const path = orgHref(orgId, `/clients/${clientId}`);
  const api = await serverApi();
  const [client, invoices, role] = await Promise.all([
    serverRead(
      api.GET('/v1/orgs/{orgId}/clients/{clientId}', { params: { path: { orgId, clientId } } }),
      path,
    ),
    serverRead(
      api.GET('/v1/orgs/{orgId}/invoices', {
        params: { path: { orgId }, query: { clientId, limit: 200 } },
      }),
      path,
    ),
    orgRole(orgId),
  ]);
  const writable = canWrite(role);

  return (
    <PageContainer className="max-w-5xl">
      <PageHeader
        title={client.name}
        description={
          client.archivedAt ? 'Archived client' : `Invoices in ${client.defaultCurrency}`
        }
        actions={writable ? <ClientActions orgId={orgId} client={client} /> : undefined}
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-4 sm:p-5 lg:col-span-2">
          <dl className="grid gap-4 sm:grid-cols-2">
            <Detail label="Country" value={client.country} />
            <Detail label="Tax ID" value={client.taxId} />
            <Detail label="Email" value={client.email} />
            <Detail label="Address" value={client.address} />
            <Detail label="Notes" value={client.notes} />
          </dl>
        </Card>
        <Card className="flex flex-col gap-2 p-4 sm:p-5">
          <h2 className="text-sm font-medium text-fg-muted">Outstanding</h2>
          {client.outstanding.length === 0 ? (
            <p className="text-2xl font-semibold tracking-tight">Nothing owed</p>
          ) : (
            client.outstanding.map((o) => (
              <p key={o.currency} className="text-2xl font-semibold tracking-tight">
                <Amount minor={o.amountMinor} currency={o.currency} />
              </p>
            ))
          )}
          <p className="text-xs text-fg-muted">
            {client.overdueCount > 0
              ? `${client.overdueCount} overdue ${client.overdueCount === 1 ? 'invoice' : 'invoices'}`
              : 'Nothing overdue'}
            {' · '}
            {client.invoiceCount} issued
          </p>
        </Card>
      </div>

      <section aria-labelledby="history-heading" className="mt-8">
        <h2 id="history-heading" className="mb-3 text-base font-semibold">
          Invoice history
        </h2>
        {invoices.items.length === 0 ? (
          <EmptyState
            icon={<FileText />}
            title="No invoices yet"
            description="Invoices for this client show up here."
          />
        ) : (
          <InvoiceTable
            orgId={orgId}
            invoices={invoices.items}
            showClient={false}
            caption={`Invoices for ${client.name}`}
          />
        )}
      </section>
    </PageContainer>
  );
}
