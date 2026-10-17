'use client';

import {
  Badge,
  Button,
  Card,
  Dialog,
  DialogFooter,
  EmptyState,
  SkeletonText,
  toast,
} from '@geo-ie-accounting/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2, Wand2 } from 'lucide-react';
import { useState } from 'react';
import { Notice } from '@/components/Notice';
import { RuleDialog } from '@/components/RuleDialog';
import { errorMessage } from '@/lib/api/api-error';
import { newIdempotencyKey } from '@/lib/api/browser';
import {
  accountsQuery,
  deleteRule,
  ledgerKeys,
  reorderRules,
  type Rule,
  rulesQuery,
} from '@/lib/api/ledger';
import { describeConditions } from '@/lib/rules';

export function RulesView({ orgId, canWrite }: { orgId: string; canWrite: boolean }) {
  const queryClient = useQueryClient();
  const rulesQ = useQuery(rulesQuery(orgId));
  const accountsQ = useQuery(accountsQuery(orgId));
  const [editing, setEditing] = useState<Rule | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Rule | null>(null);
  const key = ledgerKeys.rules(orgId);

  const reorder = useMutation({
    mutationFn: (ids: string[]) => reorderRules(orgId, ids, newIdempotencyKey()),
    onMutate: async (ids) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<Rule[]>(key);
      if (previous) {
        const byId = new Map(previous.map((r) => [r.id, r]));
        queryClient.setQueryData<Rule[]>(
          key,
          ids.flatMap((id) => byId.get(id) ?? []),
        );
      }
      return { previous };
    },
    onError: (err, _ids, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
      toast({ title: 'Could not reorder', description: errorMessage(err), tone: 'negative' });
    },
    onSuccess: (list) => {
      queryClient.setQueryData(key, list.items);
    },
  });

  const remove = useMutation({
    mutationFn: (rule: Rule) => deleteRule(orgId, rule.id, newIdempotencyKey()),
    onSuccess: async (rule) => {
      setDeleting(null);
      await queryClient.invalidateQueries({ queryKey: key });
      toast({ title: `Deleted “${rule.name}”`, tone: 'positive' });
    },
  });

  const rules = rulesQ.data ?? [];
  const accountName = (id: string) =>
    accountsQ.data?.find((a) => a.id === id)?.name ?? 'Archived account';

  function move(index: number, by: -1 | 1) {
    const ids = rules.map((r) => r.id);
    const [moved] = ids.splice(index, 1);
    if (moved === undefined) return;
    ids.splice(index + by, 0, moved);
    reorder.mutate(ids);
  }

  return (
    <div className="flex flex-col gap-4">
      {canWrite ? (
        <div className="flex justify-end">
          <Button
            onPress={() => {
              setEditing('new');
            }}
          >
            <Plus aria-hidden />
            New rule
          </Button>
        </div>
      ) : null}

      {rulesQ.isError ? (
        <Notice tone="error" title="Could not load the rules">
          {errorMessage(rulesQ.error)}
        </Notice>
      ) : rulesQ.isPending ? (
        <SkeletonText lines={4} />
      ) : rules.length === 0 ? (
        <EmptyState
          icon={<Wand2 />}
          title="No rules yet"
          description="Rules book recurring statement lines for you: a client's payments as income, the bank's fees as an expense. Create one here or from a row in an import preview."
        />
      ) : (
        <Card className="p-0">
          <ol aria-label="Rules, in the order they are tried">
            {rules.map((rule, i) => (
              <li
                key={rule.id}
                aria-label={rule.name}
                className="flex flex-wrap items-center gap-3 border-b border-line p-3 last:border-b-0 sm:p-4"
              >
                <span
                  aria-hidden
                  className="flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-muted text-xs font-semibold tabular-nums"
                >
                  {i + 1}
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex flex-wrap items-center gap-2 font-medium">
                    {rule.name}
                    {rule.isActive ? null : <Badge tone="warning">Inactive</Badge>}
                  </span>
                  <span className="text-xs text-fg-muted">{describeConditions(rule)}</span>
                  <span className="text-sm">→ {accountName(rule.targetAccountId)}</span>
                </div>
                {canWrite ? (
                  <div className="flex items-center gap-1">
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Move ${rule.name} up`}
                      isDisabled={i === 0 || reorder.isPending}
                      onPress={() => {
                        move(i, -1);
                      }}
                    >
                      <ArrowUp aria-hidden />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Move ${rule.name} down`}
                      isDisabled={i === rules.length - 1 || reorder.isPending}
                      onPress={() => {
                        move(i, 1);
                      }}
                    >
                      <ArrowDown aria-hidden />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Edit ${rule.name}`}
                      onPress={() => {
                        setEditing(rule);
                      }}
                    >
                      <Pencil aria-hidden />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Delete ${rule.name}`}
                      onPress={() => {
                        remove.reset();
                        setDeleting(rule);
                      }}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ol>
        </Card>
      )}
      <p className="text-xs text-fg-muted">
        The first matching rule wins, and a rule wins over the built-in suggestions (incoming
        payments as small-business income, exchanges through FX Clearing). New uploads use the rules
        straight away; an open preview picks changes up with “Re-apply rules”.
      </p>

      <RuleDialog
        orgId={orgId}
        isOpen={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        rule={editing === 'new' || editing === null ? undefined : editing}
        onSaved={async (saved) => {
          await queryClient.invalidateQueries({ queryKey: key });
          toast({ title: `Saved “${saved.name}”`, tone: 'positive' });
        }}
      />
      <Dialog
        role="alertdialog"
        title="Delete this rule?"
        description="Rows it already suggested keep their account."
        isOpen={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        size="sm"
      >
        {deleting ? <p className="text-sm font-medium">{deleting.name}</p> : null}
        {remove.isError ? <Notice tone="error">{errorMessage(remove.error)}</Notice> : null}
        <DialogFooter>
          <Button
            variant="secondary"
            onPress={() => {
              setDeleting(null);
            }}
          >
            Cancel
          </Button>
          <Button
            variant="danger"
            isPending={remove.isPending}
            onPress={() => {
              if (deleting) remove.mutate(deleting);
            }}
          >
            Delete rule
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}
