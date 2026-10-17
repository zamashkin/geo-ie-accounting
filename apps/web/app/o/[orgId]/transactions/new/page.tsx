import { ButtonLink, PageContainer, PageHeader } from '@geo-ie-accounting/ui';
import { ArrowLeft } from 'lucide-react';
import type { Metadata } from 'next';
import { Notice } from '@/components/Notice';
import { canWrite, orgRole } from '@/lib/auth/role';
import { orgHref } from '@/lib/nav';
import { NewTransactionForm } from './NewTransactionForm';

export const metadata: Metadata = { title: 'New transaction' };

export default async function NewTransactionPage({
  params,
}: PageProps<'/o/[orgId]/transactions/new'>) {
  const { orgId } = await params;
  const role = await orgRole(orgId);
  return (
    <PageContainer className="max-w-6xl">
      <PageHeader
        title="New transaction"
        description="Book something that is not on an imported statement. Amounts are converted to GEL at the NBG rate of the date."
        actions={
          <ButtonLink href={orgHref(orgId, '/transactions')} variant="ghost">
            <ArrowLeft aria-hidden />
            Transactions
          </ButtonLink>
        }
      />
      {canWrite(role) ? (
        <NewTransactionForm orgId={orgId} isOwner={role === 'owner'} />
      ) : (
        <Notice tone="info" title="Read-only access">
          Only owners and accountants can book transactions.
        </Notice>
      )}
    </PageContainer>
  );
}
