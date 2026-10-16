import { PageContainer, PageHeader } from '@ie-ledger/ui';
import type { Metadata } from 'next';
import { canWrite, orgRole } from '@/lib/auth/role';
import { RulesView } from './RulesView';

export const metadata: Metadata = { title: 'Rules' };

export default async function RulesPage({ params }: PageProps<'/o/[orgId]/settings/rules'>) {
  const { orgId } = await params;
  const writable = canWrite(await orgRole(orgId));
  return (
    <PageContainer className="max-w-4xl">
      <PageHeader
        title="Rules"
        description="Categorisation rules for imported statement lines, in the order they are tried."
      />
      <RulesView orgId={orgId} canWrite={writable} />
    </PageContainer>
  );
}
