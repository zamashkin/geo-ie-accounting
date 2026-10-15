'use client';

import {
  type ColumnDef,
  type ColumnFiltersState,
  columnFilteringFeature,
  createColumnHelper,
  FlexRender,
  type Header,
  metaHelper,
  type OnChangeFn,
  type RowData,
  rowSortingFeature,
  type SortingState,
  tableFeatures,
  useTable,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import {
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { cx } from '../../lib/cx';
import { focusRingNative } from '../../lib/styles';
import { Skeleton } from '../skeleton/Skeleton';

// ── Column model ──────────────────────────────────────────────────────────────────────────

export interface DataTableColumnMeta {
  /** Numbers and money align to the end. */
  align?: 'start' | 'end';
  /** CSS grid track for the column, e.g. `'7.5rem'` or `'minmax(12rem, 2fr)'`. */
  width?: string;
  /** Hide on narrow screens (below `md`). The column stays in the accessibility tree order. */
  hideBelowMd?: boolean;
}

/**
 * The feature set every DataTable uses. Sorting and filtering are server-side: the table
 * only tracks their state; the caller fetches rows already sorted and filtered.
 */
export const dataTableFeatures = tableFeatures({
  rowSortingFeature,
  columnFilteringFeature,
  columnMeta: metaHelper<DataTableColumnMeta>(),
});
export type DataTableFeatures = typeof dataTableFeatures;

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- accessor value types vary per column
export type DataTableColumn<T extends RowData> = ColumnDef<DataTableFeatures, T, any>;

/** Column helper bound to DataTable's features. Build columns once, at module scope. */
export function createDataTableColumns<T extends RowData>() {
  return createColumnHelper<DataTableFeatures, T>();
}

export type { ColumnFiltersState, SortingState };

// ── Props ────────────────────────────────────────────────────────────────────────────────

export interface DataTableProps<T extends RowData> {
  /** Accessible name of the table, e.g. "Transactions". */
  label: string;
  /** Stable column definitions (module scope or memoised). */
  columns: readonly DataTableColumn<T>[];
  /** Rows loaded so far, already sorted and filtered by the server. Keep the reference stable. */
  data: readonly T[];
  getRowId: (row: T) => string;

  /** Server-side sorting. Without `onSortingChange` headers are not sortable. */
  sorting?: SortingState;
  onSortingChange?: (sorting: SortingState) => void;

  /** Server-side column filters, exposed to header renderers via `column.setFilterValue`. */
  columnFilters?: ColumnFiltersState;
  onColumnFiltersChange?: (filters: ColumnFiltersState) => void;

  /** Cursor pagination: more rows exist on the server. */
  hasNextPage?: boolean;
  isFetchingNextPage?: boolean;
  /** Called when the user scrolls near the end of the loaded rows. */
  onLoadMore?: () => void;
  /** Total matching rows if the server knows it; otherwise the table reports "unknown". */
  totalRowCount?: number;

  /** First load: shows skeleton rows. */
  isLoading?: boolean;
  /** Shown when there are no rows and nothing is loading. */
  emptyState?: ReactNode;

  /** Makes rows interactive: click, Enter or Space. Arrow keys move between rows. */
  onRowAction?: (row: T) => void;
  /** Accessible name for a row when it is interactive, e.g. "Open transaction 12 Oct". */
  getRowLabel?: (row: T) => string;

  /** Fixed row height in px. Rows are not measured, which keeps 50k rows cheap. */
  rowHeight?: number;
  /** Height of the scroll area. Default fills 70% of the viewport. */
  height?: CSSProperties['height'];
  /** Rows rendered beyond the viewport on each side. */
  overscan?: number;
  className?: string;
}

const DEFAULT_TRACK = 'minmax(8rem, 1fr)';
const EMPTY_SORTING: SortingState = [];
const EMPTY_FILTERS: ColumnFiltersState = [];

function resolve<S>(updater: S | ((old: S) => S), old: S): S {
  return typeof updater === 'function' ? (updater as (old: S) => S)(old) : updater;
}

// ── Component ────────────────────────────────────────────────────────────────────────────

/**
 * Virtualised table for long, server-paginated lists (transactions, import rows).
 *
 * - Only the visible rows (plus `overscan`) are in the DOM; row height is fixed.
 * - Semantics stay a real `<table>`: `aria-rowcount`/`aria-rowindex` tell screen readers
 *   where they are in the full list, `aria-sort` marks the sorted column.
 * - Interactive rows use a roving tabindex: one Tab stop, then arrows, Home/End,
 *   PageUp/PageDown, Enter.
 */
export function DataTable<T extends RowData>({
  label,
  columns,
  data,
  getRowId,
  sorting = EMPTY_SORTING,
  onSortingChange,
  columnFilters = EMPTY_FILTERS,
  onColumnFiltersChange,
  hasNextPage = false,
  isFetchingNextPage = false,
  onLoadMore,
  totalRowCount,
  isLoading = false,
  emptyState,
  onRowAction,
  getRowLabel,
  rowHeight = 44,
  height = '70vh',
  overscan = 12,
  className,
}: DataTableProps<T>) {
  const handleSorting: OnChangeFn<SortingState> = useCallback(
    (updater) => onSortingChange?.(resolve(updater, sorting)),
    [onSortingChange, sorting],
  );
  const handleFilters: OnChangeFn<ColumnFiltersState> = useCallback(
    (updater) => onColumnFiltersChange?.(resolve(updater, columnFilters)),
    [onColumnFiltersChange, columnFilters],
  );

  const table = useTable({
    features: dataTableFeatures,
    columns: columns as DataTableColumn<T>[],
    data,
    getRowId,
    manualSorting: true,
    manualFiltering: true,
    enableSorting: onSortingChange !== undefined,
    enableMultiSort: false,
    state: { sorting, columnFilters },
    onSortingChange: handleSorting,
    onColumnFiltersChange: handleFilters,
  });

  const rows = table.getRowModel().rows;
  const leafColumns = table.getAllLeafColumns();
  const gridTemplateColumns = leafColumns
    .map((c) => c.columnDef.meta?.width ?? DEFAULT_TRACK)
    .join(' ');

  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan,
    getItemKey: (index) => rows[index]?.id ?? index,
  });
  const virtualRows = virtualizer.getVirtualItems();

  // Ask for the next page when the rendered window gets close to the end.
  const lastVisibleIndex = virtualRows.at(-1)?.index ?? -1;
  useEffect(() => {
    if (!onLoadMore || !hasNextPage || isFetchingNextPage) return;
    if (lastVisibleIndex >= rows.length - 1 - overscan) onLoadMore();
  }, [lastVisibleIndex, rows.length, hasNextPage, isFetchingNextPage, onLoadMore, overscan]);

  // Roving tabindex for interactive rows.
  const interactive = onRowAction !== undefined;
  const [activeIndex, setActiveIndex] = useState(0);
  const safeActive = Math.min(activeIndex, Math.max(rows.length - 1, 0));
  const pendingFocus = useRef<number | null>(null);

  useEffect(() => {
    const target = pendingFocus.current;
    if (target === null) return;
    const el = scrollRef.current?.querySelector<HTMLElement>(`tr[data-index="${target}"]`);
    if (el) {
      el.focus({ preventScroll: true });
      pendingFocus.current = null;
    }
  });

  function moveTo(index: number) {
    const next = Math.max(0, Math.min(index, rows.length - 1));
    setActiveIndex(next);
    pendingFocus.current = next;
    virtualizer.scrollToIndex(next, { align: 'auto' });
  }

  function onBodyKeyDown(e: KeyboardEvent<HTMLTableSectionElement>) {
    if (!interactive || rows.length === 0) return;
    const page = Math.max(
      1,
      Math.floor((scrollRef.current?.clientHeight ?? rowHeight) / rowHeight) - 1,
    );
    const keyMoves: Record<string, number> = {
      ArrowDown: safeActive + 1,
      ArrowUp: safeActive - 1,
      PageDown: safeActive + page,
      PageUp: safeActive - page,
      Home: 0,
      End: rows.length - 1,
    };
    const target = keyMoves[e.key];
    if (target !== undefined) {
      e.preventDefault();
      moveTo(target);
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      const row = rows[safeActive];
      if (row) {
        e.preventDefault();
        onRowAction(row.original);
      }
    }
  }

  const statusId = useId();
  const showEmpty = !isLoading && rows.length === 0;
  const ariaRowCount =
    totalRowCount !== undefined ? totalRowCount + 1 : hasNextPage ? -1 : rows.length + 1;

  const rowStyle: CSSProperties = { display: 'grid', gridTemplateColumns };

  return (
    <div
      className={cx(
        'flex flex-col overflow-hidden rounded-lg border border-line bg-surface',
        className,
      )}
    >
      <div
        ref={scrollRef}
        // Keyboard users must be able to scroll; when rows are focusable they provide that.
        tabIndex={interactive && rows.length > 0 ? undefined : 0}
        role="region"
        aria-label={`${label}, scrollable`}
        aria-describedby={statusId}
        className={cx(focusRingNative, 'relative overflow-auto overscroll-contain')}
        style={{ height, contain: 'strict' }}
      >
        <table
          aria-label={label}
          aria-rowcount={ariaRowCount}
          aria-busy={isLoading || isFetchingNextPage || undefined}
          className="grid min-w-max text-sm md:min-w-full"
        >
          <thead className="sticky top-0 z-10 grid border-b border-line bg-surface-muted/95 backdrop-blur-sm">
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id} aria-rowindex={1} style={rowStyle}>
                {group.headers.map((header) => (
                  <HeaderCell key={header.id} header={header} />
                ))}
              </tr>
            ))}
          </thead>
          <tbody
            className="relative grid"
            style={{ height: showEmpty || isLoading ? undefined : virtualizer.getTotalSize() }}
            onKeyDown={onBodyKeyDown}
          >
            {isLoading
              ? Array.from({ length: 8 }, (_, i) => (
                  <tr
                    key={i}
                    aria-hidden
                    style={{ ...rowStyle, height: rowHeight }}
                    className="border-b border-line"
                  >
                    {leafColumns.map((col) => (
                      <td key={col.id} className="flex items-center px-3">
                        <Skeleton className="h-3.5 w-3/4" />
                      </td>
                    ))}
                  </tr>
                ))
              : null}
            {showEmpty ? (
              <tr style={{ display: 'grid' }}>
                <td style={{ gridColumn: '1 / -1' }} className="p-4">
                  {emptyState ?? <p className="py-8 text-center text-fg-muted">No rows</p>}
                </td>
              </tr>
            ) : null}
            {!isLoading
              ? virtualRows.map((item) => {
                  const row = rows[item.index];
                  if (!row) return null;
                  const isActive = interactive && item.index === safeActive;
                  return (
                    <tr
                      key={row.id}
                      data-index={item.index}
                      aria-rowindex={item.index + 2}
                      aria-label={
                        interactive && getRowLabel ? getRowLabel(row.original) : undefined
                      }
                      tabIndex={interactive ? (isActive ? 0 : -1) : undefined}
                      onClick={interactive ? () => onRowAction(row.original) : undefined}
                      onFocus={interactive ? () => setActiveIndex(item.index) : undefined}
                      className={cx(
                        'absolute inset-x-0 top-0 border-b border-line text-fg',
                        interactive &&
                          'cursor-pointer outline-none hover:bg-surface-muted focus-visible:bg-accent-soft focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus',
                      )}
                      style={{
                        ...rowStyle,
                        height: rowHeight,
                        transform: `translateY(${item.start}px)`,
                      }}
                    >
                      {row.getAllCells().map((cell) => {
                        const meta = cell.column.columnDef.meta;
                        return (
                          <td
                            key={cell.id}
                            className={cx(
                              'flex min-w-0 items-center px-3',
                              meta?.align === 'end' && 'justify-end text-end',
                              meta?.hideBelowMd && 'max-md:hidden',
                            )}
                          >
                            <div className="min-w-0 truncate">
                              <FlexRender cell={cell} />
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })
              : null}
          </tbody>
        </table>
        {isFetchingNextPage ? (
          <div
            aria-hidden
            className="sticky bottom-0 flex items-center justify-center border-t border-line bg-surface/95 py-2 text-xs text-fg-muted"
          >
            Loading more…
          </div>
        ) : null}
      </div>
      <p id={statusId} role="status" className="sr-only">
        {isLoading
          ? 'Loading'
          : isFetchingNextPage
            ? 'Loading more rows'
            : `${rows.length}${totalRowCount !== undefined ? ` of ${totalRowCount}` : ''} rows${hasNextPage ? ', scroll for more' : ''}`}
      </p>
    </div>
  );
}

function HeaderCell<T extends RowData>({
  header,
}: {
  header: Header<DataTableFeatures, T, unknown>;
}) {
  const column = header.column;
  const meta = column.columnDef.meta;
  const canSort = column.getCanSort();
  const sorted = column.getIsSorted();
  const ariaSort =
    sorted === 'asc'
      ? 'ascending'
      : sorted === 'desc'
        ? 'descending'
        : canSort
          ? 'none'
          : undefined;
  const SortIcon = sorted === 'asc' ? ArrowUp : sorted === 'desc' ? ArrowDown : ChevronsUpDown;
  const content = header.isPlaceholder ? null : <FlexRender header={header} />;

  return (
    <th
      scope="col"
      aria-sort={ariaSort}
      className={cx(
        'flex min-w-0 items-center px-3 py-2.5 text-xs font-medium tracking-wide text-fg-muted',
        meta?.align === 'end' && 'justify-end text-end',
        meta?.hideBelowMd && 'max-md:hidden',
      )}
    >
      {canSort ? (
        <button
          type="button"
          onClick={column.getToggleSortingHandler()}
          className={cx(
            focusRingNative,
            '-mx-1.5 inline-flex min-w-0 items-center gap-1 rounded-sm px-1.5 py-0.5 hover:bg-surface hover:text-fg',
            sorted && 'text-fg',
            meta?.align === 'end' && 'flex-row-reverse',
          )}
        >
          <span className="truncate">{content}</span>
          <SortIcon aria-hidden className={cx('size-3.5 shrink-0', !sorted && 'opacity-60')} />
        </button>
      ) : (
        <span className="truncate">{content}</span>
      )}
    </th>
  );
}
