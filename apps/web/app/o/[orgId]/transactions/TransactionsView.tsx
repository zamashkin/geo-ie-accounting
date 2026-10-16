'use client';

import {
  Badge,
  Button,
  ButtonLink,
  createDataTableColumns,
  DataTable,
  DatePicker,
  EmptyState,
  Select,
  TextField,
} from '@ie-ledger/ui';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { ArrowLeftRight } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { Amount } from '@/components/Amount';
import { Notice } from '@/components/Notice';
import { errorMessage } from '@/lib/api/api-error';
import {
  accountsQuery,
  type TransactionFilters,
  transactionsQuery,
  type TransactionView,
} from '@/lib/api/ledger';
import { formatIsoDate, formatMinor } from '@/lib/format';
import { TRANSACTION_SOURCE_LABELS } from '@/lib/labels';
import { orgHref } from '@/lib/nav';
import { defineTableParams } from '@/lib/url-state/table-params';
import { useTableParams } from '@/lib/url-state/use-table-params';
import { TransactionSheet } from './TransactionSheet';

const SOURCES = ['import', 'reversal', 'manual', 'invoice_payment'] as const;
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/**
 * `?from=&to=&account=&source=&q=&taxable=1` filter the list; `?tx=` opens a transaction.
 */
const params = defineTableParams({
  filters: z.object({
    from: isoDate.optional(),
    to: isoDate.optional(),
    account: z.uuid().optional(),
    source: z.enum(SOURCES).optional(),
    q: z.string().trim().min(1).max(200).optional(),
    taxable: z.literal('1').optional(),
    tx: z.uuid().optional(),
  }),
  sortable: [],
});

type Params = z.output<typeof params.filters>;

const col = createDataTableColumns<TransactionView>();

/** For imported lines the first posting is the bank leg: the original statement amount. */
const bankLeg = (t: TransactionView) => t.postings[0];

const COLUMNS = [
  col.accessor('occurredOn', {
    header: 'Date',
    cell: (info) => formatIsoDate(info.getValue()),
    meta: { width: '7.5rem' },
  }),
  col.accessor('description', {
    header: 'Description',
    cell: (info) => <span title={info.getValue()}>{info.getValue()}</span>,
    meta: { width: 'minmax(14rem, 3fr)' },
  }),
  col.display({
    id: 'account',
    header: 'Account',
    cell: ({ row }) => bankLeg(row.original)?.account.name ?? '—',
    meta: { width: 'minmax(10rem, 1fr)', hideBelowMd: true },
  }),
  col.display({
    id: 'amount',
    header: 'Amount',
    cell: ({ row }) => {
      const leg = bankLeg(row.original);
      return leg ? <Amount minor={leg.amountMinor} currency={leg.currency} tone="signed" /> : null;
    },
    meta: { width: '9.5rem', align: 'end' },
  }),
  col.display({
    id: 'gel',
    header: 'GEL',
    cell: ({ row }) => {
      const leg = bankLeg(row.original);
      return leg ? <Amount minor={leg.gelAmountMinor} currency="GEL" display="none" /> : null;
    },
    meta: { width: '8.5rem', align: 'end' },
  }),
  col.display({
    id: 'status',
    header: 'Source',
    cell: ({ row }) => (
      <span className="flex gap-1">
        <Badge tone={row.original.source === 'reversal' ? 'warning' : 'neutral'}>
          {TRANSACTION_SOURCE_LABELS[row.original.source]}
        </Badge>
        {row.original.reversedById ? <Badge tone="negative">Reversed</Badge> : null}
      </span>
    ),
    meta: { width: '10rem' },
  }),
];

function Filters({
  orgId,
  filters,
  onChange,
}: {
  orgId: string;
  filters: Params;
  onChange: (patch: Partial<Params>) => void;
}) {
  const accounts = useQuery(accountsQuery(orgId));
  const accountOptions = useMemo(
    () => [
      { id: 'all', label: 'All accounts' },
      ...(accounts.data ?? [])
        .filter((a) => a.archivedAt === null)
        .map((a) => ({ id: a.id, label: a.name })),
    ],
    [accounts.data],
  );
  const active = Object.entries(filters).some(([k, v]) => k !== 'tx' && v !== undefined);
  const [search, setSearch] = useState(filters.q ?? '');
  const [prevQ, setPrevQ] = useState(filters.q);
  // Follow the URL when it changes elsewhere (Clear filters, Back).
  if (filters.q !== prevQ) {
    setPrevQ(filters.q);
    setSearch(filters.q ?? '');
  }
  // Typing updates the URL after a pause, not on every keystroke.
  useEffect(() => {
    const q = search.trim() === '' ? undefined : search.trim();
    if (q === filters.q) return;
    const timer = setTimeout(() => {
      onChange({ q });
    }, 350);
    return () => {
      clearTimeout(timer);
    };
  }, [search, filters.q, onChange]);

  return (
    <fieldset className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[repeat(4,minmax(0,1fr))_auto] lg:items-end">
      <legend className="sr-only">Filters</legend>
      <TextField
        type="search"
        label="Search"
        description="Description or counterparty"
        value={search}
        onChange={setSearch}
        className="sm:col-span-2"
      />
      <label className="flex items-center gap-2 self-center text-sm sm:col-span-2 lg:col-span-3">
        <input
          type="checkbox"
          className="size-4 accent-accent"
          checked={filters.taxable === '1'}
          onChange={(e) => {
            onChange({ taxable: e.target.checked ? '1' : undefined });
          }}
        />
        Taxable only (small-business income)
      </label>
      <DatePicker
        label="From"
        value={filters.from ?? null}
        onChange={(from) => {
          onChange({ from: from ?? undefined });
        }}
      />
      <DatePicker
        label="To"
        value={filters.to ?? null}
        {...(filters.from ? { minValue: filters.from } : {})}
        onChange={(to) => {
          onChange({ to: to ?? undefined });
        }}
      />
      <Select
        label="Account"
        options={accountOptions}
        value={filters.account ?? 'all'}
        onChange={(id) => {
          onChange({ account: id && id !== 'all' ? id : undefined });
        }}
      />
      <Select
        label="Source"
        options={[
          { id: 'all', label: 'Any source' },
          ...SOURCES.map((s) => ({ id: s, label: TRANSACTION_SOURCE_LABELS[s] })),
        ]}
        value={filters.source ?? 'all'}
        onChange={(id) => {
          const source = SOURCES.find((s) => s === id);
          onChange({ source });
        }}
      />
      <Button
        variant="ghost"
        isDisabled={!active}
        onPress={() => {
          onChange({
            from: undefined,
            to: undefined,
            account: undefined,
            source: undefined,
            q: undefined,
            taxable: undefined,
          });
        }}
      >
        Clear filters
      </Button>
    </fieldset>
  );
}

export function TransactionsView({ orgId, canWrite }: { orgId: string; canWrite: boolean }) {
  const [state, setState] = useTableParams(params);
  const { filters } = state;
  const setFilters = useCallback(
    (patch: Partial<Params>) => {
      setState({ filters: { ...filters, ...patch } });
    },
    [filters, setState],
  );

  const query: TransactionFilters = useMemo(
    () => ({
      from: filters.from,
      to: filters.to,
      accountId: filters.account,
      source: filters.source,
      q: filters.q,
      taxable: filters.taxable === '1' ? true : undefined,
    }),
    [filters.from, filters.to, filters.account, filters.source, filters.q, filters.taxable],
  );
  const list = useInfiniteQuery(transactionsQuery(orgId, query));
  const rows = useMemo(() => list.data?.pages.flatMap((p) => p.items) ?? [], [list.data]);
  const filtered = Object.values(query).some((v) => v !== undefined);

  return (
    <>
      <Filters orgId={orgId} filters={filters} onChange={setFilters} />
      {list.isError ? (
        <Notice tone="error" title="Could not load transactions">
          {errorMessage(list.error)}
        </Notice>
      ) : (
        <DataTable
          label="Transactions"
          columns={COLUMNS}
          data={rows}
          getRowId={(t) => t.id}
          isLoading={list.isPending}
          hasNextPage={list.hasNextPage}
          isFetchingNextPage={list.isFetchingNextPage}
          onLoadMore={() => void list.fetchNextPage()}
          onRowAction={(t) => {
            setFilters({ tx: t.id });
          }}
          getRowLabel={(t) => {
            const leg = bankLeg(t);
            const amount = leg ? `, ${formatMinor(leg.amountMinor, leg.currency)}` : '';
            return `Open ${formatIsoDate(t.occurredOn)}${amount}, ${t.description}`;
          }}
          height="min(70vh, 40rem)"
          emptyState={
            <EmptyState
              icon={<ArrowLeftRight />}
              headingLevel={3}
              title={filtered ? 'No transactions match the filters' : 'No transactions yet'}
              description={
                filtered
                  ? 'Change or clear the filters.'
                  : 'Import a bank statement to book its lines.'
              }
              actions={
                filtered ? undefined : (
                  <ButtonLink href={orgHref(orgId, '/imports')}>Import a statement</ButtonLink>
                )
              }
            />
          }
        />
      )}
      <TransactionSheet
        orgId={orgId}
        transactionId={filters.tx ?? null}
        initial={rows.find((t) => t.id === filters.tx)}
        canWrite={canWrite}
        onOpen={(id) => {
          setFilters({ tx: id });
        }}
        onClose={() => {
          setFilters({ tx: undefined });
        }}
      />
    </>
  );
}
