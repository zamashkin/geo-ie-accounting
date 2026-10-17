import { Card, PageContainer, PageHeader } from '@geo-ie-accounting/ui';
import type { Metadata } from 'next';
import { serverApi, serverRead } from '@/lib/api/server';
import { formatIsoDate } from '@/lib/format';
import { orgHref } from '@/lib/nav';
import { InvoiceProfileForm } from './InvoiceProfileForm';
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
      <PageHeader
        title="Workspace"
        description="Details the declarations depend on, and what your invoices print."
      />
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
      <Card className="mt-6 flex flex-col gap-4 p-5 sm:p-6">
        <section aria-labelledby="invoice-heading" className="flex flex-col gap-3">
          <div>
            <h2 id="invoice-heading" className="text-base font-semibold">
              Invoice details
            </h2>
            <p className="text-sm text-fg-muted">
              Printed on every invoice as the seller. The bank details come from the account you
              pick on each invoice.
            </p>
          </div>
          {org.role === 'owner' ? (
            <InvoiceProfileForm org={org} />
          ) : (
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              {[
                ['Tax ID', org.taxId],
                ['Address', org.address],
                ['Email', org.email],
                ['Phone', org.phone],
                ['Number prefix', org.invoicePrefix],
                ['Payment terms', `${org.invoiceDueDays} days`],
                ['Invoice note', org.invoiceNote],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-fg-muted">{label}</dt>
                  <dd className="font-medium">{value ?? '—'}</dd>
                </div>
              ))}
            </dl>
          )}
        </section>
      </Card>
    </PageContainer>
  );
}
