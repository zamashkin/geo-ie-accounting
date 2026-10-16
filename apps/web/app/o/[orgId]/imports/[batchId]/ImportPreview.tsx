'use client';

import {
  Badge,
  Button,
  ButtonLink,
  Card,
  createDataTableColumns,
  cx,
  DataTable,
  EmptyState,
  PageHeader,
  Select,
  SkeletonText,
  toast,
} from '@ie-ledger/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, FileQuestion } from 'lucide-react';
import { createContext, useContext, useMemo, useState } from 'react';
import { Amount } from '@/components/Amount';
import { Notice } from '@/components/Notice';
import { type ApiError, errorMessage, isApiError } from '@/lib/api/api-error';
import { newIdempotencyKey } from '@/lib/api/browser';
import type { Schemas } from '@/lib/api/client';
import {
  type Account,
  accountsQuery,
  commitImport,
  type ImportBatchDetail,
  importBatchQuery,
  importRowsQuery,
  type ImportRowView,
  ledgerKeys,
  updateImportRow,
  type UploadStatementResponse,
} from '@/lib/api/ledger';
import { formatIsoDate, formatScore, formatTimestamp } from '@/lib/format';
import {
  ACCOUNT_MATCH_LABELS,
  BATCH_STATUS,
  OPERATION_TYPE_LABELS,
  PARSER_LABELS,
  ROW_STATUS,
} from '@/lib/labels';
import { orgHref } from '@/lib/nav';
import { NARROW_SCREEN, useMediaQuery } from '@/lib/use-media-query';
import { applyRowPatch, blockedRowIds, bookableRows, rowAccountOptions } from './preview-model';

// ── Row cells read the page state through context, so the columns stay at module scope ──

interface RowContext {
  accounts: readonly Account[];
  bankAccountId: string;
  editable: boolean;
  committed: boolean;
  blocked: ReadonlySet<string>;
  onChoose: (row: ImportRowView, accountId: string | null) => void;
  onSkip: (row: ImportRowView, skip: boolean) => void;
}

const RowCtx = createContext<RowContext | null>(null);

function useRowCtx(): RowContext {
  const ctx = useContext(RowCtx);
  if (!ctx) throw new Error('Import row cell outside its table');
  return ctx;
}

function rowName(row: ImportRowView): string {
  return `${formatIsoDate(row.bookedOn)}, ${row.counterparty ?? row.description}`;
}

function StatusCell({ row }: { row: ImportRowView }) {
  const { blocked, committed } = useRowCtx();
  if (blocked.has(row.id)) {
    return (
      <Badge tone="negative" dot>
        Pick an account
      </Badge>
    );
  }
  if (committed && row.status === 'new') {
    return (
      <Badge tone="positive" dot>
        Booked
      </Badge>
    );
  }
  const s = ROW_STATUS[row.status];
  return (
    <Badge tone={s.tone} dot>
      {s.label}
    </Badge>
  );
}

function AccountCell({ row }: { row: ImportRowView }) {
  const { accounts, bankAccountId, editable, committed, onChoose } = useRowCtx();
  const name = accounts.find((a) => a.id === row.accountId)?.name;
  if (!editable || committed || row.status !== 'new') {
    return (
      <span className={row.status === 'new' ? undefined : 'text-fg-muted'}>{name ?? '—'}</span>
    );
  }
  return (
    <Select
      aria-label={`Account for ${rowName(row)}`}
      placeholder="Choose account"
      className="w-full"
      options={rowAccountOptions(accounts, bankAccountId, row.currency)}
      value={row.accountId}
      onChange={(value) => {
        if (value !== row.accountId) onChoose(row, value);
      }}
    />
  );
}

function SkipCell({ row }: { row: ImportRowView }) {
  const { editable, committed, onSkip } = useRowCtx();
  if (!editable || committed || row.status === 'duplicate') return null;
  const skipped = row.status === 'skipped';
  return (
    <Button
      size="sm"
      variant="ghost"
      aria-label={`${skipped ? 'Include' : 'Skip'} ${rowName(row)}`}
      onPress={() => {
        onSkip(row, !skipped);
      }}
    >
      {skipped ? 'Include' : 'Skip'}
    </Button>
  );
}

const col = createDataTableColumns<ImportRowView>();

const COLUMNS = [
  col.accessor('bookedOn', {
    header: 'Date',
    cell: (info) => formatIsoDate(info.getValue()),
    meta: { width: '6.5rem' },
  }),
  col.display({
    id: 'description',
    header: 'Details',
    cell: ({ row }) => (
      <span className="flex min-w-0 flex-col" title={row.original.description}>
        <span className="truncate font-medium">
          {row.original.counterparty ?? row.original.description}
        </span>
        {row.original.counterparty ? (
          <span className="truncate text-xs text-fg-muted">{row.original.description}</span>
        ) : null}
      </span>
    ),
    meta: { width: 'minmax(8.5rem, 1fr)' },
  }),
  col.accessor('amountMinor', {
    header: 'Amount',
    cell: ({ row }) => (
      <Amount minor={row.original.amountMinor} currency={row.original.currency} tone="signed" />
    ),
    meta: { width: '8rem', align: 'end' },
  }),
  col.accessor('operationType', {
    header: 'Type',
    cell: (info) => OPERATION_TYPE_LABELS[info.getValue()],
    meta: { width: '10rem' },
  }),
  col.accessor('status', {
    header: 'Status',
    cell: ({ row }) => <StatusCell row={row.original} />,
    meta: { width: '9rem' },
  }),
  col.display({
    id: 'account',
    header: 'Book against',
    cell: ({ row }) => <AccountCell row={row.original} />,
    // Wide enough for the default chart of accounts; longer names show in full on hover.
    meta: { width: '13rem' },
  }),
  col.display({
    id: 'skip',
    header: () => <span className="sr-only">Skip</span>,
    cell: ({ row }) => <SkipCell row={row.original} />,
    meta: { width: '5.5rem', align: 'end' },
  }),
];

// ── Narrow screens: one card per row instead of a sideways-scrolling table ────────────

function RowCard({ row }: { row: ImportRowView }) {
  const { blocked } = useRowCtx();
  return (
    <li
      aria-label={rowName(row)}
      className={cx(
        'flex flex-col gap-3 rounded-lg border bg-surface p-3 shadow-sm',
        blocked.has(row.id) ? 'border-negative' : 'border-line',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <span className="font-medium break-words">{row.counterparty ?? row.description}</span>
          {row.counterparty ? (
            <span
              className="line-clamp-3 text-xs break-words text-fg-muted"
              title={row.description}
            >
              {row.description}
            </span>
          ) : null}
        </div>
        <Amount
          minor={row.amountMinor}
          currency={row.currency}
          tone="signed"
          className="font-medium"
        />
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-muted">
        <time dateTime={row.bookedOn}>{formatIsoDate(row.bookedOn)}</time>
        <span aria-hidden>·</span>
        <span>{OPERATION_TYPE_LABELS[row.operationType]}</span>
        <StatusCell row={row} />
      </div>
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <AccountCell row={row} />
        </div>
        <SkipCell row={row} />
      </div>
    </li>
  );
}

function RowCards({ rows, isLoading }: { rows: readonly ImportRowView[]; isLoading: boolean }) {
  if (isLoading) return <SkeletonText lines={4} />;
  return (
    <ul aria-label="Statement rows" className="flex flex-col gap-2">
      {rows.map((row) => (
        <RowCard key={row.id} row={row} />
      ))}
    </ul>
  );
}

// ── Summary ────────────────────────────────────────────────────────────────────────────

function Stat({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs text-fg-muted">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums">{value ?? 0}</dd>
    </div>
  );
}

function Summary({
  detail,
  upload,
}: {
  detail: ImportBatchDetail;
  upload: UploadStatementResponse | undefined;
}) {
  const { batch, account } = detail;
  const match = upload ? ACCOUNT_MATCH_LABELS[upload.accountMatch] : null;
  const confidence = upload?.detection.confidence;
  return (
    <Card className="grid gap-5 p-4 sm:p-5 lg:grid-cols-2">
      <section aria-labelledby="sum-account" className="flex min-w-0 flex-col gap-1">
        <h2 id="sum-account" className="text-xs font-medium text-fg-muted">
          Bank account
        </h2>
        <p className="flex flex-wrap items-center gap-2 font-medium">
          {account.name}
          {match ? <Badge tone="info">{match.label}</Badge> : null}
        </p>
        <p className="truncate font-mono text-xs text-fg-muted">
          {account.iban ?? 'No IBAN'} · {account.currency ?? 'any currency'}
        </p>
        {match ? <p className="text-xs text-fg-muted">{match.detail}</p> : null}
      </section>
      <section aria-labelledby="sum-format" className="flex min-w-0 flex-col gap-1">
        <h2 id="sum-format" className="text-xs font-medium text-fg-muted">
          Statement
        </h2>
        <p className="font-medium">
          {PARSER_LABELS[batch.bankFormat]}
          {confidence !== undefined ? (
            <span className="font-normal text-fg-muted">
              {' '}
              · detected with {formatScore(confidence)} confidence
            </span>
          ) : null}
        </p>
        <p className="text-xs text-fg-muted">
          {batch.periodFrom && batch.periodTo
            ? `${formatIsoDate(batch.periodFrom)} – ${formatIsoDate(batch.periodTo)}`
            : 'No period in the file'}{' '}
          · uploaded {formatTimestamp(batch.createdAt)}
        </p>
        {confidence !== undefined && confidence < 0.5 ? (
          <p className="text-xs text-warning-fg">
            Low confidence: check that the rows below look right.
          </p>
        ) : null}
      </section>
      <section
        aria-labelledby="sum-rows"
        className="flex flex-col gap-1 border-t border-line pt-4 lg:col-span-2"
      >
        <h2 id="sum-rows" className="text-xs font-medium text-fg-muted">
          Rows
        </h2>
        <dl className="flex flex-wrap gap-x-6 gap-y-2">
          <Stat label="In file" value={batch.stats.total} />
          {batch.status === 'committed' ? (
            <Stat label="Booked" value={batch.stats.committed} />
          ) : (
            <Stat label="New" value={batch.stats.new} />
          )}
          <Stat label="Already booked" value={batch.stats.duplicate} />
          <Stat label="Skipped" value={batch.stats.skipped} />
          <Stat label="Warnings" value={batch.warnings.length} />
        </dl>
      </section>
    </Card>
  );
}

function Warnings({ warnings }: { warnings: readonly Schemas['ParseWarning'][] }) {
  if (warnings.length === 0) return null;
  return (
    <Notice
      tone="warning"
      title={`${warnings.length} parser warning${warnings.length === 1 ? '' : 's'}`}
    >
      <ul className="list-disc ps-4">
        {warnings.map((w, i) => (
          <li key={`${w.code}-${i}`}>
            {w.rowIndex !== null ? `Row ${w.rowIndex + 1}: ` : ''}
            {w.message}
          </li>
        ))}
      </ul>
    </Notice>
  );
}

function CommitError({ error, onRetry }: { error: ApiError | Error; onRetry: () => void }) {
  if (isApiError(error)) {
    const rows = blockedRowIds(error).size;
    if (error.code === 'validation_failed' && rows > 0) {
      return (
        <Notice tone="error" title="Some rows have no account">
          {rows === 1 ? 'One row needs' : `${rows} rows need`} an account before booking. Pick one
          in the highlighted rows, or skip them.
        </Notice>
      );
    }
    if (error.code === 'conflict') {
      return (
        <Notice tone="warning" title="Already booked">
          {error.problem.detail ?? 'This import was booked elsewhere.'} The page now shows the
          current state.
        </Notice>
      );
    }
    if (error.code === 'rate_unavailable') {
      return (
        <Notice
          tone="warning"
          title="NBG rate not available yet"
          actions={
            <Button size="sm" variant="secondary" onPress={onRetry}>
              Try again
            </Button>
          }
        >
          {error.problem.detail} Nothing was booked.
        </Notice>
      );
    }
  }
  return (
    <Notice
      tone="error"
      title="Booking failed"
    >{`${errorMessage(error)} Nothing was booked.`}</Notice>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────────────

export function ImportPreview({
  orgId,
  batchId,
  canWrite,
}: {
  orgId: string;
  batchId: string;
  canWrite: boolean;
}) {
  const queryClient = useQueryClient();
  const batchQ = useQuery(importBatchQuery(orgId, batchId));
  const rowsQ = useQuery(importRowsQuery(orgId, batchId));
  const accountsQ = useQuery(accountsQuery(orgId));
  // Account match and format detection come only with the upload response.
  const [upload] = useState(() =>
    queryClient.getQueryData<UploadStatementResponse>(ledgerKeys.importUpload(orgId, batchId)),
  );
  const [blocked, setBlocked] = useState<ReadonlySet<string>>(new Set());
  const narrow = useMediaQuery(NARROW_SCREEN);

  const rowsKey = ledgerKeys.importRows(orgId, batchId);
  const batchKey = ledgerKeys.importBatch(orgId, batchId);

  const patchRow = useMutation({
    mutationFn: (v: { row: ImportRowView; body: Schemas['UpdateImportRowRequestInput'] }) =>
      updateImportRow(orgId, batchId, v.row.id, v.body, newIdempotencyKey()),
    onMutate: async ({ row, body }) => {
      await queryClient.cancelQueries({ queryKey: rowsKey });
      const previous = queryClient.getQueryData<ImportRowView[]>(rowsKey);
      queryClient.setQueryData<ImportRowView[]>(rowsKey, (rows) =>
        rows?.map((r) => (r.id === row.id ? applyRowPatch(r, body) : r)),
      );
      return { previous };
    },
    onError: (err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(rowsKey, context.previous);
      toast({
        title: 'Could not change the row',
        description: errorMessage(err),
        tone: 'negative',
      });
    },
    onSuccess: (updated) => {
      queryClient.setQueryData<ImportRowView[]>(rowsKey, (rows) =>
        rows?.map((r) => (r.id === updated.id ? updated : r)),
      );
      if (updated.accountId !== null || updated.status !== 'new') {
        setBlocked((b) => {
          if (!b.has(updated.id)) return b;
          const next = new Set(b);
          next.delete(updated.id);
          return next;
        });
      }
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: batchKey }),
  });

  const commit = useMutation({
    mutationFn: (key: string) => commitImport(orgId, batchId, key),
    onSuccess: (result) => {
      setBlocked(new Set());
      queryClient.setQueryData<ImportBatchDetail>(batchKey, (old) =>
        old ? { ...old, batch: result.batch } : old,
      );
      void queryClient.invalidateQueries({ queryKey: rowsKey });
      void queryClient.invalidateQueries({ queryKey: ledgerKeys.imports(orgId) });
      void queryClient.invalidateQueries({ queryKey: ledgerKeys.transactions(orgId) });
      const n = result.transactionIds.length;
      toast({
        title: n === 0 ? 'Import closed' : `Booked ${n} transaction${n === 1 ? '' : 's'}`,
        tone: 'positive',
      });
    },
    onError: (err) => {
      if (isApiError(err)) {
        setBlocked(blockedRowIds(err));
        if (err.code === 'conflict') {
          void queryClient.invalidateQueries({ queryKey: batchKey });
          void queryClient.invalidateQueries({ queryKey: rowsKey });
        }
      }
    },
  });

  const rows = rowsQ.data;
  const detail = batchQ.data;
  const committed = detail?.batch.status === 'committed';
  const editable = canWrite && detail?.batch.status === 'preview';

  const ctx = useMemo<RowContext | null>(
    () =>
      detail
        ? {
            accounts: accountsQ.data ?? [],
            bankAccountId: detail.batch.accountId,
            editable,
            committed,
            blocked,
            onChoose: (row, accountId) => {
              patchRow.mutate({ row, body: { accountId } });
            },
            onSkip: (row, skip) => {
              patchRow.mutate({ row, body: { skip } });
            },
          }
        : null,
    // patchRow.mutate is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [detail, accountsQ.data, editable, committed, blocked],
  );

  if (batchQ.isError) {
    const missing = isApiError(batchQ.error) && batchQ.error.status === 404;
    return (
      <EmptyState
        icon={<FileQuestion />}
        title={missing ? 'Import not found' : 'Could not load the import'}
        description={missing ? 'It may belong to another workspace.' : errorMessage(batchQ.error)}
        actions={<ButtonLink href={orgHref(orgId, '/imports')}>Back to imports</ButtonLink>}
      />
    );
  }

  if (!detail || !ctx) {
    return (
      <div aria-busy className="flex flex-col gap-4">
        <span className="sr-only" role="status">
          Loading import
        </span>
        <SkeletonText lines={4} />
      </div>
    );
  }

  const { batch } = detail;
  const toBook = rows ? bookableRows(rows) : [];
  const duplicates = rows?.filter((r) => r.status === 'duplicate').length ?? 0;
  const year = (batch.periodTo ?? rows?.[0]?.bookedOn ?? batch.createdAt).slice(0, 4);
  const status = BATCH_STATUS[batch.status];

  return (
    <>
      <PageHeader
        title={batch.fileName}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={status.tone} dot>
              {status.label}
            </Badge>
            {committed
              ? 'Booked into the ledger.'
              : 'Check the rows, change an account or skip a row, then book.'}
          </span>
        }
        actions={
          <ButtonLink href={orgHref(orgId, '/imports')} variant="ghost">
            <ArrowLeft aria-hidden />
            All imports
          </ButtonLink>
        }
      />
      <div className="flex flex-col gap-4">
        <Summary detail={detail} upload={upload} />
        <Warnings warnings={batch.warnings} />

        {committed ? (
          <Notice
            tone="success"
            live
            title={`Booked ${batch.stats.committed ?? 0} transaction${batch.stats.committed === 1 ? '' : 's'}`}
            actions={
              <>
                <ButtonLink
                  size="sm"
                  variant="secondary"
                  href={orgHref(orgId, `/transactions?account=${batch.accountId}`)}
                >
                  View transactions
                </ButtonLink>
                <ButtonLink
                  size="sm"
                  variant="secondary"
                  href={orgHref(orgId, `/declarations?year=${year}`)}
                >
                  View {year} declarations
                </ButtonLink>
              </>
            }
          >
            {duplicates > 0
              ? `${duplicates} line${duplicates === 1 ? ' was' : 's were'} already in the ledger and not booked again.`
              : 'Every new line is now a transaction, converted to GEL at the NBG rate of its date.'}
          </Notice>
        ) : rows && toBook.length === 0 && duplicates > 0 ? (
          <Notice tone="info" title="Nothing new in this statement">
            {duplicates === rows.length
              ? `All ${duplicates} lines are already in the ledger, so nothing will be booked twice.`
              : `${duplicates} lines are already in the ledger; the rest are skipped.`}
          </Notice>
        ) : null}

        {commit.isError ? (
          <CommitError
            error={commit.error}
            onRetry={() => {
              commit.mutate(newIdempotencyKey());
            }}
          />
        ) : null}

        {editable && rows ? (
          <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface-muted p-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm">
              {toBook.length === 0
                ? 'No rows to book.'
                : `${toBook.length} row${toBook.length === 1 ? '' : 's'} will be booked, each converted to GEL at the NBG rate of its date.`}
            </p>
            <Button
              isPending={commit.isPending}
              isDisabled={patchRow.isPending}
              onPress={() => {
                commit.mutate(newIdempotencyKey());
              }}
            >
              {toBook.length === 0
                ? 'Close import'
                : `Book ${toBook.length} transaction${toBook.length === 1 ? '' : 's'}`}
            </Button>
          </div>
        ) : null}

        {rowsQ.isError ? (
          <Notice tone="error" title="Could not load the rows">
            {errorMessage(rowsQ.error)}
          </Notice>
        ) : (
          <RowCtx.Provider value={ctx}>
            {narrow ? (
              <RowCards rows={rows ?? []} isLoading={rowsQ.isPending} />
            ) : (
              <DataTable
                label="Statement rows"
                columns={COLUMNS}
                data={rows ?? []}
                getRowId={(r) => r.id}
                isLoading={rowsQ.isPending}
                rowHeight={56}
                height={`${Math.min(rows?.length ?? 8, 10) * 56 + 42}px`}
              />
            )}
          </RowCtx.Provider>
        )}
      </div>
    </>
  );
}
