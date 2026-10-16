'use client';

import { Button, EmptyState, PageContainer } from '@ie-ledger/ui';
import { AlertTriangle } from 'lucide-react';

/**
 * A page of the workspace failed to load (the API is down or answered 5xx). The shell stays,
 * so the user can retry or go elsewhere. Server errors only reach here as a digest, never with
 * details.
 */
export default function OrgPageError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <PageContainer>
      <EmptyState
        icon={<AlertTriangle />}
        headingLevel={2}
        title="This page could not be loaded"
        description={`The API did not answer as expected. Check that it is running, then try again.${error.digest ? ` (Reference ${error.digest})` : ''}`}
        actions={<Button onPress={retry}>Try again</Button>}
      />
    </PageContainer>
  );
}
