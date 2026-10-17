'use client';

import {
  Badge,
  Button,
  Card,
  EmptyState,
  Menu,
  MenuItem,
  MenuTrigger,
  SkeletonText,
  toast,
} from '@geo-ie-accounting/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Landmark, MoreHorizontal, Plus } from 'lucide-react';
import { useState } from 'react';
import { Amount } from '@/components/Amount';
import { Notice } from '@/components/Notice';
import { ACCOUNT_KIND_LABELS, ACCOUNT_KINDS, accountRole, isBankAccount } from '@/lib/accounts';
import { errorMessage } from '@/lib/api/api-error';
import { newIdempotencyKey } from '@/lib/api/browser';
import {
  type Account,
  type AccountBalance,
  accountBalancesQuery,
  allAccountsQuery,
  ledgerKeys,
  updateAccount,
} from '@/lib/api/ledger';
import { formatIsoDate } from '@/lib/format';
import { NewAccountDialog, RenameAccountDialog } from './AccountForms';

function Balances({ balance, account }: { balance: AccountBalance | undefined; account: Account }) {
  const items = balance?.balances ?? [];
  const gel = balance?.gelValue;
  return (
    <div className="flex flex-col items-end gap-0.5 text-sm">
      {items.length === 0 ? (
        <Amount minor="0" currency={account.currency ?? 'GEL'} className="text-fg-muted" />
      ) : (
        items.map((b) => (
          <Amount key={b.currency} minor={b.amountMinor} currency={b.currency} tone="signed" />
        ))
      )}
      {gel?.rate ? (
        <span className="text-xs text-fg-muted">
          ≈ <Amount minor={gel.amountMinor} currency="GEL" /> at {gel.rate.rate} (
          <time dateTime={gel.rate.validFrom}>{formatIsoDate(gel.rate.validFrom)}</time>)
        </span>
      ) : null}
    </div>
  );
}

function AccountRow({
  account,
  balance,
  canWrite,
  onRename,
  onArchive,
}: {
  account: Account;
  balance: AccountBalance | undefined;
  canWrite: boolean;
  onRename: (a: Account) => void;
  onArchive: (a: Account, archived: boolean) => void;
}) {
  const archived = account.archivedAt !== null;
  return (
    <li
      className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b border-line py-3 last:border-b-0"
      aria-label={account.name}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex flex-wrap items-center gap-2 font-medium">
          <span className={archived ? 'text-fg-muted line-through' : undefined}>
            {account.name}
          </span>
          {account.systemKey ? <Badge tone="neutral">System</Badge> : null}
          {account.incomeClass === 'sbs' ? <Badge tone="accent">SBS income</Badge> : null}
          {archived ? <Badge tone="warning">Archived</Badge> : null}
        </span>
        <span className="text-xs text-fg-muted">
          {accountRole(account)}
          {account.iban ? (
            <>
              {' · '}
              <span className="font-mono">{account.iban}</span>
            </>
          ) : null}
        </span>
      </div>
      <div className="flex items-start gap-2">
        <Balances balance={balance} account={account} />
        {canWrite ? (
          <MenuTrigger>
            <Button size="icon-sm" variant="ghost" aria-label={`Actions for ${account.name}`}>
              <MoreHorizontal aria-hidden />
            </Button>
            <Menu
              onAction={(action) => {
                if (action === 'rename') onRename(account);
                if (action === 'archive') onArchive(account, true);
                if (action === 'restore') onArchive(account, false);
              }}
            >
              <MenuItem id="rename">Rename</MenuItem>
              {account.systemKey ? null : archived ? (
                <MenuItem id="restore">Restore</MenuItem>
              ) : (
                <MenuItem id="archive">Archive</MenuItem>
              )}
            </Menu>
          </MenuTrigger>
        ) : null}
      </div>
    </li>
  );
}

export function AccountsView({ orgId, canWrite }: { orgId: string; canWrite: boolean }) {
  const queryClient = useQueryClient();
  const accountsQ = useQuery(allAccountsQuery(orgId));
  const balancesQ = useQuery(accountBalancesQuery(orgId));
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<Account | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const archive = useMutation({
    mutationFn: (v: { account: Account; archived: boolean }) =>
      updateAccount(orgId, v.account.id, { archived: v.archived }, newIdempotencyKey()),
    onSuccess: async (account) => {
      await queryClient.invalidateQueries({ queryKey: ledgerKeys.accounts(orgId) });
      toast({
        title: account.archivedAt ? `Archived ${account.name}` : `Restored ${account.name}`,
        tone: 'positive',
      });
    },
    onError: (err) => {
      toast({
        title: 'Could not change the account',
        description: errorMessage(err),
        tone: 'negative',
      });
    },
  });

  const balances = new Map((balancesQ.data?.items ?? []).map((b) => [b.accountId, b]));
  const all = accountsQ.data ?? [];
  const visible = all.filter((a) => showArchived || a.archivedAt === null);
  const archivedCount = all.length - all.filter((a) => a.archivedAt === null).length;

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
            New account
          </Button>
        ) : null}
      </div>

      {accountsQ.isError ? (
        <Notice tone="error" title="Could not load the accounts">
          {errorMessage(accountsQ.error)}
        </Notice>
      ) : null}
      {balancesQ.isError ? (
        <Notice tone="warning" title="Balances are not available">
          {errorMessage(balancesQ.error)}
        </Notice>
      ) : null}

      {accountsQ.isPending ? (
        <SkeletonText lines={6} />
      ) : all.length === 0 ? (
        <EmptyState icon={<Landmark />} title="No accounts" description="Create the first one." />
      ) : (
        ACCOUNT_KINDS.map((kind) => {
          const group = visible.filter((a) => a.kind === kind);
          if (group.length === 0) return null;
          const bank = kind === 'asset' && group.some(isBankAccount);
          const total = balancesQ.data;
          return (
            <Card key={kind} className="p-4 sm:p-5">
              <section aria-labelledby={`group-${kind}`}>
                <header className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
                  <h2 id={`group-${kind}`} className="text-base font-semibold">
                    {ACCOUNT_KIND_LABELS[kind]}
                  </h2>
                  {bank && total ? (
                    <p className="text-sm text-fg-muted" data-testid="bank-total">
                      Bank accounts in GEL:{' '}
                      <Amount
                        minor={total.bankTotalGelMinor}
                        currency="GEL"
                        className="font-medium text-fg"
                      />{' '}
                      (NBG rates on {formatIsoDate(total.asOf)})
                    </p>
                  ) : null}
                </header>
                {bank && total && total.bankAccountsWithoutRate.length > 0 ? (
                  <p className="text-xs text-warning-fg">
                    {total.bankAccountsWithoutRate.length} account(s) have no stored NBG rate yet
                    and are left out of the total.
                  </p>
                ) : null}
                <ul>
                  {group.map((a) => (
                    <AccountRow
                      key={a.id}
                      account={a}
                      balance={balances.get(a.id)}
                      canWrite={canWrite}
                      onRename={setRenaming}
                      onArchive={(account, archived) => {
                        archive.mutate({ account, archived });
                      }}
                    />
                  ))}
                </ul>
              </section>
            </Card>
          );
        })
      )}
      <p className="text-xs text-fg-muted">
        Balances are shown on each account&apos;s normal side: money held for bank accounts, amounts
        earned for income, owed for liabilities. A bank account can be archived once its balance is
        zero.
      </p>

      <NewAccountDialog orgId={orgId} isOpen={creating} onOpenChange={setCreating} />
      <RenameAccountDialog
        orgId={orgId}
        account={renaming}
        onClose={() => {
          setRenaming(null);
        }}
      />
    </div>
  );
}
