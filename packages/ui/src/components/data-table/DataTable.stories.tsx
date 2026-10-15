import type { Meta, StoryObj } from '@storybook/react-vite';
import { useCallback, useMemo, useState } from 'react';
import { expect, fn, waitFor } from 'storybook/test';
import { Badge } from '../badge/Badge';
import { MoneyText } from '../money/MoneyText';
import { Select } from '../select/Select';
import { createDataTableColumns, DataTable, type SortingState } from './DataTable';

// ── Generated data (deterministic) ─────────────────────────────────────────────────────

interface TxRow {
  id: string;
  occurredOn: string;
  counterparty: string;
  description: string;
  amountMinor: string;
  currency: string;
  gelAmountMinor: string;
  source: 'manual' | 'import' | 'reversal';
}

const COUNTERPARTIES = [
  'Acme GmbH',
  'Upwork Global',
  'Toptal LLC',
  'Deel Inc.',
  'Bank of Georgia',
  'Silknet',
  'Magti',
  'Owner top-up',
];
const CURRENCIES = ['USD', 'EUR', 'GBP', 'GEL'] as const;
const RATES_E4: Record<(typeof CURRENCIES)[number], bigint> = {
  USD: 27123n,
  EUR: 29481n,
  GBP: 34950n,
  GEL: 10000n,
};

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateRows(count: number, seed = 42): TxRow[] {
  const rand = mulberry32(seed);
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)] as T;
  const start = Date.UTC(2026, 0, 1);
  return Array.from({ length: count }, (_, i) => {
    const currency = pick(CURRENCIES);
    const income = rand() > 0.3;
    const magnitude = BigInt(Math.floor(rand() * 500_000) + 100);
    const amount = income ? magnitude : -magnitude;
    const day = new Date(start + Math.floor(rand() * 288) * 86_400_000).toISOString().slice(0, 10);
    return {
      id: `tx-${i}`,
      occurredOn: day,
      counterparty: pick(COUNTERPARTIES),
      description: income ? `Invoice #${1000 + (i % 900)}` : 'Card payment',
      amountMinor: amount.toString(),
      currency,
      gelAmountMinor: ((amount * RATES_E4[currency]) / 10000n).toString(),
      source: i % 97 === 0 ? 'reversal' : i % 3 === 0 ? 'manual' : 'import',
    };
  });
}

/** Stands in for the API: sorts and filters "server-side" and returns pages by cursor. */
function serverQuery(all: readonly TxRow[], sorting: SortingState, source: string | null): TxRow[] {
  const filtered = source ? all.filter((r) => r.source === source) : [...all];
  const sort = sorting[0];
  if (!sort) return filtered;
  const dir = sort.desc ? -1 : 1;
  const key = sort.id as keyof TxRow;
  return filtered.sort((a, b) => {
    if (key === 'gelAmountMinor' || key === 'amountMinor') {
      const d = BigInt(a[key]) - BigInt(b[key]);
      return d === 0n ? 0 : d > 0n ? dir : -dir;
    }
    return a[key] < b[key] ? -dir : a[key] > b[key] ? dir : 0;
  });
}

// ── Columns (module scope: stable) ─────────────────────────────────────────────────────

const col = createDataTableColumns<TxRow>();
const columns = col.columns([
  col.accessor('occurredOn', { header: 'Date', meta: { width: '7.5rem' } }),
  col.accessor('counterparty', {
    header: 'Counterparty',
    meta: { width: 'minmax(10rem, 1.2fr)' },
  }),
  col.accessor('description', {
    header: 'Description',
    enableSorting: false,
    meta: { width: 'minmax(10rem, 1.5fr)', hideBelowMd: true },
  }),
  col.accessor('source', {
    header: 'Source',
    enableSorting: false,
    meta: { width: '7rem', hideBelowMd: true },
    cell: (info) => {
      const v = info.getValue();
      return (
        <Badge tone={v === 'reversal' ? 'warning' : v === 'import' ? 'info' : 'neutral'}>{v}</Badge>
      );
    },
  }),
  col.accessor('amountMinor', {
    header: 'Amount',
    meta: { align: 'end', width: '9.5rem' },
    cell: (info) => (
      <MoneyText
        amountMinor={info.getValue()}
        currency={info.row.original.currency}
        tone="signed"
      />
    ),
  }),
  col.accessor('gelAmountMinor', {
    header: 'GEL',
    meta: { align: 'end', width: '9rem' },
    cell: (info) => (
      <MoneyText amountMinor={info.getValue()} currency="GEL" currencyDisplay="none" />
    ),
  }),
]);

const ROWS_50K = generateRows(50_000);
const PAGE = 200;

// ── Stories ────────────────────────────────────────────────────────────────────────────

const meta = {
  title: 'Data/DataTable',
  component: DataTable<TxRow>,
  parameters: { layout: 'fullscreen' },
  args: {
    label: 'Transactions',
    columns,
    data: ROWS_50K,
    getRowId: (r: TxRow) => r.id,
    height: 560,
  },
  decorators: [(Story) => <div className="p-4">{Story()}</div>],
} satisfies Meta<typeof DataTable<TxRow>>;
export default meta;
type Story = StoryObj<typeof meta>;

function FiftyThousandDemo({ onRowAction }: { onRowAction?: (row: TxRow) => void }) {
  const [sorting, setSorting] = useState<SortingState>([{ id: 'occurredOn', desc: true }]);
  const [source, setSource] = useState<string | null>(null);
  const data = useMemo(() => serverQuery(ROWS_50K, sorting, source), [sorting, source]);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <Select
          label="Source"
          className="w-48"
          value={source ?? 'all'}
          onChange={(v) => {
            setSource(v === 'all' ? null : v);
          }}
          options={[
            { id: 'all', label: 'All sources' },
            { id: 'import', label: 'Import' },
            { id: 'manual', label: 'Manual' },
            { id: 'reversal', label: 'Reversal' },
          ]}
        />
        <p className="pb-2 text-sm text-fg-muted">{data.length.toLocaleString('en-GB')} rows</p>
      </div>
      <DataTable
        label="Transactions"
        columns={columns}
        data={data}
        getRowId={(r) => r.id}
        sorting={sorting}
        onSortingChange={setSorting}
        totalRowCount={data.length}
        height={560}
        {...(onRowAction
          ? { onRowAction, getRowLabel: (r: TxRow) => `${r.occurredOn}, ${r.counterparty}` }
          : {})}
      />
    </div>
  );
}

/** 50,000 rows, sorted and filtered "on the server". Only ~30 rows are ever in the DOM. */
export const FiftyThousandRows: Story = {
  render: () => <FiftyThousandDemo />,
  play: async ({ canvas, canvasElement, userEvent }) => {
    const table = canvas.getByRole('table', { name: 'Transactions' });
    await expect(table).toHaveAttribute('aria-rowcount', '50001');
    const rendered = canvasElement.querySelectorAll('tbody tr');
    await expect(rendered.length).toBeLessThan(80);

    // Sort by amount: server-side, header reports it.
    const amountHeader = canvas.getByRole('columnheader', { name: /amount/i });
    await userEvent.click(canvas.getByRole('button', { name: /^amount/i }));
    await expect(amountHeader).toHaveAttribute('aria-sort', 'ascending');

    // Scroll to the bottom: still virtualised, last row index is 50001.
    const scroller = canvas.getByRole('region', { name: /transactions, scrollable/i });
    scroller.scrollTop = scroller.scrollHeight;
    await waitFor(() =>
      expect(canvasElement.querySelector('tbody tr[aria-rowindex="50001"]')).not.toBeNull(),
    );
    await expect(canvasElement.querySelectorAll('tbody tr').length).toBeLessThan(80);
  },
};

const onRowAction = fn();

export const KeyboardRowNavigation: Story = {
  render: () => <FiftyThousandDemo onRowAction={onRowAction} />,
  play: async ({ canvasElement, userEvent }) => {
    const first = canvasElement.querySelector<HTMLElement>('tbody tr[data-index="0"]');
    if (!first) throw new Error('no rows');
    first.focus();
    await userEvent.keyboard('{ArrowDown}{ArrowDown}');
    await waitFor(() => expect(document.activeElement).toHaveAttribute('data-index', '2'));
    await userEvent.keyboard('{Enter}');
    await expect(onRowAction).toHaveBeenCalledTimes(1);
    await userEvent.keyboard('{End}');
    await waitFor(() => expect(document.activeElement).toHaveAttribute('data-index', '49999'));
  },
};

function InfiniteDemo() {
  const [pages, setPages] = useState(1);
  const [fetching, setFetching] = useState(false);
  const data = useMemo(() => ROWS_50K.slice(0, pages * PAGE), [pages]);
  const loadMore = useCallback(() => {
    setFetching(true);
    setTimeout(() => {
      setPages((p) => p + 1);
      setFetching(false);
    }, 150);
  }, []);
  return (
    <DataTable
      label="Transactions"
      columns={columns}
      data={data}
      getRowId={(r) => r.id}
      hasNextPage={data.length < 1000}
      isFetchingNextPage={fetching}
      onLoadMore={loadMore}
      height={480}
    />
  );
}

/** Cursor pagination: the next page loads as the user nears the end. Total unknown. */
export const InfiniteScroll: Story = {
  render: () => <InfiniteDemo />,
  play: async ({ canvas, canvasElement }) => {
    const table = canvas.getByRole('table', { name: 'Transactions' });
    await expect(table).toHaveAttribute('aria-rowcount', '-1');
    const scroller = canvas.getByRole('region', { name: /scrollable/i });
    scroller.scrollTop = scroller.scrollHeight;
    await waitFor(() =>
      expect(canvasElement.querySelector(`tbody tr[aria-rowindex="${PAGE + 2}"]`)).not.toBeNull(),
    );
  },
};

export const Loading: Story = {
  args: { data: [], isLoading: true, height: 320 },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('table')).toHaveAttribute('aria-busy', 'true');
  },
};

export const Empty: Story = {
  args: {
    data: [],
    height: 320,
    emptyState: (
      <p className="py-10 text-center text-sm text-fg-muted">
        No transactions match these filters.
      </p>
    ),
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('No transactions match these filters.')).toBeVisible();
  },
};

export const Dark: Story = {
  args: { data: ROWS_50K.slice(0, 40), height: 400 },
  globals: { theme: 'dark' },
};
