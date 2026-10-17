import { PageContainer, PageHeader } from '@geo-ie-accounting/ui';
import type { Metadata } from 'next';
import { canWrite, orgRole } from '@/lib/auth/role';
import { ImportsView } from './ImportsView';

export const metadata: Metadata = { title: 'Imports' };

export default async function ImportsPage({ params }: PageProps<'/o/[orgId]/imports'>) {
  const { orgId } = await params;
  const writable = canWrite(await orgRole(orgId));
  return (
    <PageContainer>
      <PageHeader
        title="Imports"
        description="Upload a bank statement, check the preview, then book it. Lines already in the ledger are never booked twice."
      />
      <ImportsView orgId={orgId} canWrite={writable} />
    </PageContainer>
  );
}
