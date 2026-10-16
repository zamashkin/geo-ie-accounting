import { Card, PageContainer, PageHeader } from '@ie-ledger/ui';
import type { Metadata } from 'next';
import { serverApi, serverRead } from '@/lib/api/server';
import { formatIsoDate } from '@/lib/format';
import { orgHref } from '@/lib/nav';
import { WorkspaceSbsForm } from './WorkspaceSbsForm';

export const metadata: Metadata = { title: 'Workspace settings' };

export default async function WorkspaceSettingsPage({ params }: PageProps<'/o/[orgId]/settings'>) {
  const { orgId } = await params;
  const api = await serverApi();
  const org = await serverRead(
    api.GET('/v1/orgs/{orgId}', { params: { path: { orgId } } }),
    orgHref(orgId, '/settings'),
  );

  return (
    <PageContainer className="max-w-3xl">
      <PageHeader title="Workspace" description="Details the declarations depend on." />
      <Card className="flex flex-col gap-5 p-5 sm:p-6">
        <dl className="grid gap-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-fg-muted">Name</dt>
            <dd className="font-medium">{org.name}</dd>
          </div>
          <div>
            <dt className="text-fg-muted">Your role</dt>
            <dd className="font-medium capitalize">{org.role}</dd>
          </div>
          <div>
            <dt className="text-fg-muted">Base currency</dt>
            <dd className="font-medium">{org.baseCurrency}</dd>
          </div>
          <div>
            <dt className="text-fg-muted">Accounting method</dt>
            <dd className="font-medium capitalize">{org.accountingMethod}</dd>
          </div>
        </dl>
        <hr className="border-line" />
        <section aria-labelledby="sbs-heading" className="flex flex-col gap-3">
          <h2 id="sbs-heading" className="text-base font-semibold">
            Small-business status
          </h2>
          {org.role === 'owner' ? (
            <WorkspaceSbsForm orgId={orgId} initial={org.sbsEffectiveFrom} />
          ) : (
            <p className="text-sm">
              {org.sbsEffectiveFrom
                ? `Since ${formatIsoDate(org.sbsEffectiveFrom)}.`
                : 'No start date set.'}{' '}
              <span className="text-fg-muted">Only the owner can change it.</span>
            </p>
          )}
        </section>
      </Card>
    </PageContainer>
  );
}
