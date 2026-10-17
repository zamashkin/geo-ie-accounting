'use client';

import { Badge, Button, Card, EmptyState, SkeletonText } from '@geo-ie-accounting/ui';
import { useQuery } from '@tanstack/react-query';
import { Plus, Users } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useState } from 'react';
import { Amount } from '@/components/Amount';
import { Notice } from '@/components/Notice';
import { errorMessage } from '@/lib/api/api-error';
import { type Client, clientsQuery } from '@/lib/api/invoices';
import { orgHref } from '@/lib/nav';
import { ClientDialog } from './ClientDialog';

function ClientRow({ orgId, client }: { orgId: string; client: Client }) {
  const archived = client.archivedAt !== null;
  return (
    <li className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b border-line py-3 last:border-b-0">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex flex-wrap items-center gap-2">
          <Link
            href={orgHref(orgId, `/clients/${client.id}`) as Route}
            className={`font-medium underline-offset-4 hover:underline ${archived ? 'text-fg-muted' : ''}`}
          >
            {client.name}
          </Link>
          {archived ? <Badge tone="warning">Archived</Badge> : null}
          {client.overdueCount > 0 ? (
            <Badge tone="negative" dot>
              {client.overdueCount} overdue
            </Badge>
          ) : null}
        </span>
        <span className="text-xs text-fg-muted">
          {client.country} · invoices in {client.defaultCurrency} · {client.invoiceCount}{' '}
          {client.invoiceCount === 1 ? 'invoice' : 'invoices'}
        </span>
      </div>
      <div className="flex flex-col items-end gap-0.5 text-sm">
        {client.outstanding.length === 0 ? (
          <span className="text-fg-muted">Nothing owed</span>
        ) : (
          client.outstanding.map((o) => (
            <span key={o.currency}>
              <Amount minor={o.amountMinor} currency={o.currency} />{' '}
              <span className="text-xs text-fg-muted">owed</span>
            </span>
          ))
        )}
      </div>
    </li>
  );
}

export function ClientsView({ orgId, canWrite }: { orgId: string; canWrite: boolean }) {
  const q = useQuery(clientsQuery(orgId));
  const [creating, setCreating] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const all = q.data ?? [];
  const visible = all.filter((c) => showArchived || c.archivedAt === null);
  const archivedCount = all.filter((c) => c.archivedAt !== null).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-accent"
            checked={showArchived}
            onChange={(e) => {
              setShowArchived(e.target.checked);
            }}
          />
          Show archived ({archivedCount})
        </label>
        {canWrite ? (
          <Button
            onPress={() => {
              setCreating(true);
            }}
          >
            <Plus aria-hidden />
            New client
          </Button>
        ) : null}
      </div>
      {q.isError ? (
        <Notice tone="error" title="Could not load the clients">
          {errorMessage(q.error)}
        </Notice>
      ) : null}
      {q.isPending ? (
        <SkeletonText lines={5} />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={<Users />}
          title="No clients yet"
          description="Add the people and companies you invoice."
          actions={
            canWrite ? (
              <Button
                onPress={() => {
                  setCreating(true);
                }}
              >
                Add a client
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Card className="px-4 sm:px-5">
          <ul aria-label="Clients">
            {visible.map((c) => (
              <ClientRow key={c.id} orgId={orgId} client={c} />
            ))}
          </ul>
        </Card>
      )}
      <ClientDialog orgId={orgId} client={null} isOpen={creating} onOpenChange={setCreating} />
    </div>
  );
}
