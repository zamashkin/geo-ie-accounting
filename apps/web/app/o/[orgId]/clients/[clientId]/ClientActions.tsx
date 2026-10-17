'use client';

import { Button, ButtonLink, toast } from '@ie-ledger/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Archive, ArchiveRestore, Pencil, Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { errorMessage } from '@/lib/api/api-error';
import { newIdempotencyKey } from '@/lib/api/browser';
import { type Client, invoiceKeys, updateClient } from '@/lib/api/invoices';
import { orgHref } from '@/lib/nav';
import { ClientDialog } from '../ClientDialog';

export function ClientActions({ orgId, client }: { orgId: string; client: Client }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const archived = client.archivedAt !== null;
  const archive = useMutation({
    mutationFn: () => updateClient(orgId, client.id, { archived: !archived }, newIdempotencyKey()),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: invoiceKeys.clients(orgId) });
      toast({ title: archived ? 'Client restored' : 'Client archived', tone: 'positive' });
      router.refresh();
    },
    onError: (err) => {
      toast({
        title: 'Could not change the client',
        description: errorMessage(err),
        tone: 'negative',
      });
    },
  });

  return (
    <>
      {archived ? null : (
        <ButtonLink href={orgHref(orgId, `/invoices/new?clientId=${client.id}`)}>
          <Plus aria-hidden />
          New invoice
        </ButtonLink>
      )}
      <Button
        variant="secondary"
        onPress={() => {
          setEditing(true);
        }}
      >
        <Pencil aria-hidden />
        Edit
      </Button>
      <Button
        variant="ghost"
        isPending={archive.isPending}
        onPress={() => {
          archive.mutate();
        }}
      >
        {archived ? <ArchiveRestore aria-hidden /> : <Archive aria-hidden />}
        {archived ? 'Restore' : 'Archive'}
      </Button>
      <ClientDialog orgId={orgId} client={client} isOpen={editing} onOpenChange={setEditing} />
    </>
  );
}
