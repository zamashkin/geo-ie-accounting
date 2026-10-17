'use client';

import { toast } from '@geo-ie-accounting/ui';
import { useRouter } from 'next/navigation';
import { SbsDateForm } from '@/components/workspace/SbsDateForm';
import { formatIsoDate } from '@/lib/format';

export function WorkspaceSbsForm({ orgId, initial }: { orgId: string; initial: string | null }) {
  const router = useRouter();
  return (
    <SbsDateForm
      orgId={orgId}
      initial={initial}
      onSaved={(value) => {
        toast({
          title: 'Saved',
          description: value
            ? `Small-business status from ${formatIsoDate(value)}. Declarations are recomputed.`
            : 'No small-business status. Nothing is declared.',
          tone: 'positive',
        });
        router.refresh();
      }}
    />
  );
}
