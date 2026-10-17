import { PageContainer, PageHeader } from '@geo-ie-accounting/ui';
import type { Metadata } from 'next';
import { Notice } from '@/components/Notice';
import { serverApi, serverRead } from '@/lib/api/server';
import { canWrite, orgRole } from '@/lib/auth/role';
import { orgHref } from '@/lib/nav';
import { InvoiceEditor } from '../InvoiceEditor';

export const metadata: Metadata = { title: 'New invoice' };

export default async function NewInvoicePage({
  params,
  searchParams,
}: PageProps<'/o/[orgId]/invoices/new'>) {
  const { orgId } = await params;
  const { clientId } = await searchParams;
  const path = orgHref(orgId, '/invoices/new');
  const api = await serverApi();
  const [clients, accounts, role] = await Promise.all([
    serverRead(api.GET('/v1/orgs/{orgId}/clients', { params: { path: { orgId } } }), path),
    serverRead(api.GET('/v1/orgs/{orgId}/accounts', { params: { path: { orgId } } }), path),
    orgRole(orgId),
  ]);

  return (
    <PageContainer className="max-w-5xl">
      <PageHeader
        title="New invoice"
        description="A draft until you issue it. Issuing gives it the next number of the year."
      />
      {canWrite(role) ? (
        <InvoiceEditor
          orgId={orgId}
          invoice={null}
          clients={clients.items}
          accounts={accounts.items}
          defaultClientId={typeof clientId === 'string' ? clientId : undefined}
        />
      ) : (
        <Notice tone="info">Viewers cannot create invoices.</Notice>
      )}
    </PageContainer>
  );
}
