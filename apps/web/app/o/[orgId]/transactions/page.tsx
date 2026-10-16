import { ButtonLink, PageContainer, PageHeader, SkeletonText } from '@ie-ledger/ui';
import { Plus } from 'lucide-react';
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { canWrite, orgRole } from '@/lib/auth/role';
import { orgHref } from '@/lib/nav';
import { TransactionsView } from './TransactionsView';

export const metadata: Metadata = { title: 'Transactions' };

export default async function TransactionsPage({ params }: PageProps<'/o/[orgId]/transactions'>) {
  const { orgId } = await params;
  const writable = canWrite(await orgRole(orgId));
  return (
    <PageContainer>
      <PageHeader
        title="Transactions"
        description="Everything booked in the ledger, newest first. Amounts in the original currency and in GEL at the NBG rate of the day."
        actions={
          writable ? (
            <ButtonLink href={orgHref(orgId, '/transactions/new')}>
              <Plus aria-hidden />
              New transaction
            </ButtonLink>
          ) : undefined
        }
      />
      {/* Filters live in the URL (useSearchParams), which needs a Suspense boundary. */}
      <Suspense fallback={<SkeletonText lines={6} />}>
        <TransactionsView orgId={orgId} canWrite={writable} />
      </Suspense>
    </PageContainer>
  );
}
