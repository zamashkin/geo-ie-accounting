'use client';

import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';
import { browserApi, idempotencyHeaders } from './browser';
import type { Schemas } from './client';
import { unwrap } from './errors';

// Queries and mutations of the MVP ledger routes for client components. Shapes come from the
// generated spec (`Schemas`); every mutation takes the Idempotency-Key of the user action.

export type Account = Schemas['Account'];
export type ImportBatch = Schemas['ImportBatch'];
export type ImportBatchDetail = Schemas['ImportBatchDetail'];
export type ImportRowView = Schemas['ImportRowView'];
export type UploadStatementResponse = Schemas['UploadStatementResponse'];
export type TransactionView = Schemas['TransactionView'];
export type TransactionSource = TransactionView['source'];

export interface TransactionFilters {
  from?: string | undefined;
  to?: string | undefined;
  accountId?: string | undefined;
  source?: TransactionSource | undefined;
}

export const ledgerKeys = {
  org: (orgId: string) => ['org', orgId] as const,
  accounts: (orgId: string) => ['org', orgId, 'accounts'] as const,
  imports: (orgId: string) => ['org', orgId, 'imports'] as const,
  importBatch: (orgId: string, batchId: string) => ['org', orgId, 'imports', batchId] as const,
  importRows: (orgId: string, batchId: string) =>
    ['org', orgId, 'imports', batchId, 'rows'] as const,
  /** What the upload answered (account match, detection); only the upload returns it. */
  importUpload: (orgId: string, batchId: string) =>
    ['org', orgId, 'imports', batchId, 'upload'] as const,
  transactions: (orgId: string) => ['org', orgId, 'transactions'] as const,
  transactionList: (orgId: string, filters: TransactionFilters) =>
    ['org', orgId, 'transactions', 'list', filters] as const,
  transaction: (orgId: string, transactionId: string) =>
    ['org', orgId, 'transactions', 'one', transactionId] as const,
};

const api = () => browserApi();

export function accountsQuery(orgId: string) {
  return queryOptions({
    queryKey: ledgerKeys.accounts(orgId),
    queryFn: async ({ signal }) =>
      (
        await unwrap(
          api().GET('/v1/orgs/{orgId}/accounts', { params: { path: { orgId } }, signal }),
        )
      ).items,
    staleTime: 5 * 60_000,
  });
}

export function importsQuery(orgId: string) {
  return infiniteQueryOptions({
    queryKey: ledgerKeys.imports(orgId),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      unwrap(
        api().GET('/v1/orgs/{orgId}/imports', {
          params: {
            path: { orgId },
            query: { limit: 20, ...(pageParam ? { cursor: pageParam } : {}) },
          },
          signal,
        }),
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function importBatchQuery(orgId: string, batchId: string) {
  return queryOptions({
    queryKey: ledgerKeys.importBatch(orgId, batchId),
    queryFn: ({ signal }) =>
      unwrap(
        api().GET('/v1/orgs/{orgId}/imports/{batchId}', {
          params: { path: { orgId, batchId } },
          signal,
        }),
      ),
  });
}

/** Every row of a batch. Statements are small (5 MB at most), so all pages are loaded. */
export function importRowsQuery(orgId: string, batchId: string) {
  return queryOptions({
    queryKey: ledgerKeys.importRows(orgId, batchId),
    queryFn: async ({ signal }) => {
      const rows: ImportRowView[] = [];
      let cursor: string | undefined;
      do {
        const page = await unwrap(
          api().GET('/v1/orgs/{orgId}/imports/{batchId}/rows', {
            params: {
              path: { orgId, batchId },
              query: { limit: 200, ...(cursor ? { cursor } : {}) },
            },
            signal,
          }),
        );
        rows.push(...page.items);
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      return rows;
    },
  });
}

export async function uploadStatement(orgId: string, file: File, key: string) {
  const form = new FormData();
  form.set('file', file, file.name);
  return unwrap(
    api().POST('/v1/orgs/{orgId}/imports', {
      params: { path: { orgId } },
      headers: idempotencyHeaders(key),
      // The spec describes the multipart `file` part as a string (OpenAPI `format: binary`),
      // so the generated body type cannot hold a FormData. openapi-fetch sends a FormData body
      // as is and lets the browser set the multipart boundary.
      body: form as unknown as Schemas['UploadStatementRequestInput'],
    }),
  );
}

export function updateImportRow(
  orgId: string,
  batchId: string,
  rowId: string,
  body: Schemas['UpdateImportRowRequestInput'],
  key: string,
) {
  return unwrap(
    api().PATCH('/v1/orgs/{orgId}/imports/{batchId}/rows/{rowId}', {
      params: { path: { orgId, batchId, rowId } },
      headers: idempotencyHeaders(key),
      body,
    }),
  );
}

export function commitImport(orgId: string, batchId: string, key: string) {
  return unwrap(
    api().POST('/v1/orgs/{orgId}/imports/{batchId}/commit', {
      params: { path: { orgId, batchId } },
      headers: idempotencyHeaders(key),
    }),
  );
}

export function transactionsQuery(orgId: string, filters: TransactionFilters) {
  return infiniteQueryOptions({
    queryKey: ledgerKeys.transactionList(orgId, filters),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      unwrap(
        api().GET('/v1/orgs/{orgId}/transactions', {
          params: {
            path: { orgId },
            query: {
              limit: 50,
              ...(pageParam ? { cursor: pageParam } : {}),
              ...(filters.from ? { from: filters.from } : {}),
              ...(filters.to ? { to: filters.to } : {}),
              ...(filters.accountId ? { accountId: filters.accountId } : {}),
              ...(filters.source ? { source: filters.source } : {}),
            },
          },
          signal,
        }),
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function transactionQuery(orgId: string, transactionId: string) {
  return queryOptions({
    queryKey: ledgerKeys.transaction(orgId, transactionId),
    queryFn: ({ signal }) =>
      unwrap(
        api().GET('/v1/orgs/{orgId}/transactions/{transactionId}', {
          params: { path: { orgId, transactionId } },
          signal,
        }),
      ),
  });
}

export function reverseTransaction(orgId: string, transactionId: string, key: string) {
  return unwrap(
    api().POST('/v1/orgs/{orgId}/transactions/{transactionId}/reverse', {
      params: { path: { orgId, transactionId } },
      headers: idempotencyHeaders(key),
      body: {},
    }),
  );
}

export function createOrganization(body: Schemas['CreateOrganizationRequestInput'], key: string) {
  return unwrap(api().POST('/v1/orgs', { headers: idempotencyHeaders(key), body }));
}

export function updateOrganization(
  orgId: string,
  body: Schemas['UpdateOrganizationRequestInput'],
  key: string,
) {
  return unwrap(
    api().PATCH('/v1/orgs/{orgId}', {
      params: { path: { orgId } },
      headers: idempotencyHeaders(key),
      body,
    }),
  );
}
