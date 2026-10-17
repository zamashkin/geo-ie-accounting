import { Uuid } from '@geo-ie-accounting/contracts';
import { PageContainer } from '@geo-ie-accounting/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { canWrite, orgRole } from '@/lib/auth/role';
import { ImportPreview } from './ImportPreview';

export const metadata: Metadata = { title: 'Import preview' };

export default async function ImportPage({ params }: PageProps<'/o/[orgId]/imports/[batchId]'>) {
  const { orgId, batchId } = await params;
  if (!Uuid.safeParse(batchId).success) notFound();
  const writable = canWrite(await orgRole(orgId));
  return (
    <PageContainer>
      <ImportPreview orgId={orgId} batchId={batchId} canWrite={writable} />
    </PageContainer>
  );
}
