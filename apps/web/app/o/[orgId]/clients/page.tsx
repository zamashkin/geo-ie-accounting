import { PageContainer, PageHeader } from '@geo-ie-accounting/ui';
import type { Metadata } from 'next';
import { canWrite, orgRole } from '@/lib/auth/role';
import { ClientsView } from './ClientsView';

export const metadata: Metadata = { title: 'Clients' };

export default async function ClientsPage({ params }: PageProps<'/o/[orgId]/clients'>) {
  const { orgId } = await params;
  const writable = canWrite(await orgRole(orgId));
  return (
    <PageContainer className="max-w-4xl">
      <PageHeader
        title="Clients"
        description="The people and companies you invoice, with what they still owe."
      />
      <ClientsView orgId={orgId} canWrite={writable} />
    </PageContainer>
  );
}
