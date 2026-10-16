import { PageContainer, PageHeader } from '@ie-ledger/ui';
import type { Metadata } from 'next';
import { canWrite, orgRole } from '@/lib/auth/role';
import { AccountsView } from './AccountsView';

export const metadata: Metadata = { title: 'Accounts' };

export default async function AccountsPage({ params }: PageProps<'/o/[orgId]/settings/accounts'>) {
  const { orgId } = await params;
  const writable = canWrite(await orgRole(orgId));
  return (
    <PageContainer className="max-w-4xl">
      <PageHeader
        title="Accounts"
        description="Bank accounts and the chart of accounts, with their balances."
      />
      <AccountsView orgId={orgId} canWrite={writable} />
    </PageContainer>
  );
}
