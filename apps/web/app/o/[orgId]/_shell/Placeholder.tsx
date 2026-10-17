import { EmptyState, PageContainer, PageHeader } from '@geo-ie-accounting/ui';
import { Construction } from 'lucide-react';

/**
 * Stand-in for pages later workstreams build (WS-06 ledger, WS-07 imports, WS-08
 * declarations and dashboard, WS-09 invoices, WS-10 settings). Replace the page file, not this.
 */
export function Placeholder({
  title,
  description,
  owner,
}: {
  title: string;
  description: string;
  owner: string;
}) {
  return (
    <PageContainer>
      <PageHeader title={title} description={description} />
      <EmptyState
        icon={<Construction />}
        title="Not built yet"
        description={`This page arrives with ${owner}.`}
      />
    </PageContainer>
  );
}
