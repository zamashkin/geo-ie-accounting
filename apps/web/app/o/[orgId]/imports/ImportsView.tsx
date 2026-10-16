'use client';

import { IMPORT_MAX_FILE_BYTES } from '@ie-ledger/contracts';
import {
  Badge,
  Button,
  Card,
  createDataTableColumns,
  DataTable,
  EmptyState,
  FileDropzone,
} from '@ie-ledger/ui';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileSpreadsheet, Upload } from 'lucide-react';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { errorMessage } from '@/lib/api/api-error';
import { newIdempotencyKey } from '@/lib/api/browser';
import {
  accountsQuery,
  type ImportBatch,
  importsQuery,
  ledgerKeys,
  uploadStatement,
} from '@/lib/api/ledger';
import { formatIsoDate, formatTimestamp } from '@/lib/format';
import { BATCH_STATUS } from '@/lib/labels';
import { orgHref } from '@/lib/nav';

const ACCEPT = ['.xlsx', '.csv'] as const;

function UploadCard({ orgId }: { orgId: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [files, setFiles] = useState<File[]>([]);

  const upload = useMutation({
    mutationFn: ({ file, key }: { file: File; key: string }) => uploadStatement(orgId, file, key),
    onSuccess: (result) => {
      const batchId = result.batch.id;
      queryClient.setQueryData(ledgerKeys.importUpload(orgId, batchId), result);
      queryClient.setQueryData(ledgerKeys.importBatch(orgId, batchId), {
        batch: result.batch,
        account: result.account,
      });
      void queryClient.invalidateQueries({ queryKey: ledgerKeys.imports(orgId) });
      void queryClient.invalidateQueries({ queryKey: ledgerKeys.accounts(orgId) });
      router.push(orgHref(orgId, `/imports/${batchId}`) as Route);
    },
  });

  const file = files[0];
  return (
    <Card className="flex flex-col gap-4 p-4 sm:p-5">
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (file) upload.mutate({ file, key: newIdempotencyKey() });
        }}
      >
        <FileDropzone
          label="Bank statement"
          description="Bank of Georgia statement export, XLSX or CSV. The file is read once and not stored; the parsed lines stay in your local database."
          accept={ACCEPT}
          maxSizeBytes={IMPORT_MAX_FILE_BYTES}
          value={files}
          onChange={(next) => {
            upload.reset();
            setFiles(next);
          }}
          errorMessage={upload.isError ? errorMessage(upload.error) : undefined}
          isDisabled={upload.isPending}
        />
        <div>
          <Button type="submit" isDisabled={!file} isPending={upload.isPending}>
            <Upload aria-hidden />
            Upload and preview
          </Button>
        </div>
      </form>
    </Card>
  );
}

const col = createDataTableColumns<ImportBatch>();

function useColumns(accountNames: Map<string, string>) {
  return useMemo(
    () => [
      col.accessor('createdAt', {
        header: 'Uploaded',
        cell: (info) => formatTimestamp(info.getValue()),
        meta: { width: '11rem' },
      }),
      col.accessor('fileName', {
        header: 'File',
        cell: (info) => <span className="font-medium">{info.getValue()}</span>,
        meta: { width: 'minmax(12rem, 2fr)' },
      }),
      col.accessor('accountId', {
        header: 'Account',
        cell: (info) => accountNames.get(info.getValue()) ?? '—',
        meta: { width: 'minmax(10rem, 1fr)', hideBelowMd: true },
      }),
      col.display({
        id: 'period',
        header: 'Statement period',
        cell: ({ row }) =>
          row.original.periodFrom && row.original.periodTo
            ? `${formatIsoDate(row.original.periodFrom)} – ${formatIsoDate(row.original.periodTo)}`
            : '—',
        meta: { width: '14rem', hideBelowMd: true },
      }),
      col.display({
        id: 'rows',
        header: 'Rows',
        cell: ({ row }) => {
          const s = row.original.stats;
          const booked = row.original.status === 'committed';
          return (
            <span className="tabular-nums">
              {booked ? `${s.committed ?? 0} booked` : `${s.new ?? 0} new`}
              {s.duplicate ? `, ${s.duplicate} already booked` : ''}
            </span>
          );
        },
        meta: { width: 'minmax(10rem, 1fr)' },
      }),
      col.accessor('status', {
        header: 'Status',
        cell: (info) => {
          const s = BATCH_STATUS[info.getValue()];
          return (
            <Badge tone={s.tone} dot>
              {s.label}
            </Badge>
          );
        },
        meta: { width: '8rem' },
      }),
    ],
    [accountNames],
  );
}

function PastImports({ orgId }: { orgId: string }) {
  const router = useRouter();
  const imports = useInfiniteQuery(importsQuery(orgId));
  const accounts = useQuery(accountsQuery(orgId));
  const accountNames = useMemo(
    () => new Map((accounts.data ?? []).map((a) => [a.id, a.name])),
    [accounts.data],
  );
  const columns = useColumns(accountNames);
  const rows = useMemo(() => imports.data?.pages.flatMap((p) => p.items) ?? [], [imports.data]);

  if (imports.isError) {
    return (
      <p role="alert" className="text-sm text-negative-fg">
        Could not load past imports: {errorMessage(imports.error)}
      </p>
    );
  }

  return (
    <DataTable
      label="Past imports"
      columns={columns}
      data={rows}
      getRowId={(b) => b.id}
      isLoading={imports.isPending}
      hasNextPage={imports.hasNextPage}
      isFetchingNextPage={imports.isFetchingNextPage}
      onLoadMore={() => void imports.fetchNextPage()}
      onRowAction={(b) => {
        router.push(orgHref(orgId, `/imports/${b.id}`) as Route);
      }}
      getRowLabel={(b) => `Open import ${b.fileName}, ${formatTimestamp(b.createdAt)}`}
      // The scroll area has size containment, so it needs an explicit height: fit up to eight
      // rows, then scroll.
      height={`${(rows.length > 0 ? Math.min(rows.length, 8) : imports.isPending ? 8 : 4) * 44 + 42}px`}
      emptyState={
        <EmptyState
          icon={<FileSpreadsheet />}
          title="No imports yet"
          description="Upload your first statement above."
          headingLevel={3}
        />
      }
    />
  );
}

export function ImportsView({ orgId, canWrite }: { orgId: string; canWrite: boolean }) {
  return (
    <div className="flex flex-col gap-8">
      {canWrite ? (
        <UploadCard orgId={orgId} />
      ) : (
        <p className="text-sm text-fg-muted">Viewers can see imports but not upload statements.</p>
      )}
      <section aria-labelledby="past-imports" className="flex flex-col gap-3">
        <h2 id="past-imports" className="text-base font-semibold">
          Past imports
        </h2>
        <PastImports orgId={orgId} />
      </section>
    </div>
  );
}
