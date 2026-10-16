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

export type AccountBalanceList = Schemas['AccountBalanceList'];
export type AccountBalance = Schemas['AccountBalance'];
export type Rule = Schemas['CategorizationRule'];
export type RuleInput = Schemas['CreateRuleRequestInput'];
export type CreateTransactionInput = Schemas['CreateTransactionRequestInput'];
export type TransactionPreview = Schemas['TransactionPreview'];

export interface TransactionFilters {
  from?: string | undefined;
  to?: string | undefined;
  accountId?: string | undefined;
  source?: TransactionSource | undefined;
  q?: string | undefined;
  taxable?: boolean | undefined;
}

export const ledgerKeys = {
  org: (orgId: string) => ['org', orgId] as const,
  accounts: (orgId: string) => ['org', orgId, 'accounts'] as const,
  allAccounts: (orgId: string) => ['org', orgId, 'accounts', 'all'] as const,
  accountBalances: (orgId: string) => ['org', orgId, 'accounts', 'balances'] as const,
  rules: (orgId: string) => ['org', orgId, 'rules'] as const,
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

/** Active and archived accounts, for the accounts page. */
export function allAccountsQuery(orgId: string) {
  return queryOptions({
    queryKey: ledgerKeys.allAccounts(orgId),
    queryFn: async ({ signal }) =>
      (
        await unwrap(
          api().GET('/v1/orgs/{orgId}/accounts', {
            params: { path: { orgId }, query: { includeArchived: 'true' } },
            signal,
          }),
        )
      ).items,
  });
}

export function accountBalancesQuery(orgId: string) {
  return queryOptions({
    queryKey: ledgerKeys.accountBalances(orgId),
    queryFn: ({ signal }) =>
      unwrap(
        api().GET('/v1/orgs/{orgId}/accounts/balances', { params: { path: { orgId } }, signal }),
      ),
  });
}

export function createAccount(
  orgId: string,
  body: Schemas['CreateAccountRequestInput'],
  key: string,
) {
  return unwrap(
    api().POST('/v1/orgs/{orgId}/accounts', {
      params: { path: { orgId } },
      headers: idempotencyHeaders(key),
      body,
    }),
  );
}

export function updateAccount(
  orgId: string,
  accountId: string,
  body: Schemas['UpdateAccountRequestInput'],
  key: string,
) {
  return unwrap(
    api().PATCH('/v1/orgs/{orgId}/accounts/{accountId}', {
      params: { path: { orgId, accountId } },
      headers: idempotencyHeaders(key),
      body,
    }),
  );
}

export function rulesQuery(orgId: string) {
  return queryOptions({
    queryKey: ledgerKeys.rules(orgId),
    queryFn: async ({ signal }) =>
      (await unwrap(api().GET('/v1/orgs/{orgId}/rules', { params: { path: { orgId } }, signal })))
        .items,
  });
}

export function createRule(orgId: string, body: RuleInput, key: string) {
  return unwrap(
    api().POST('/v1/orgs/{orgId}/rules', {
      params: { path: { orgId } },
      headers: idempotencyHeaders(key),
      body,
    }),
  );
}

export function updateRule(
  orgId: string,
  ruleId: string,
  body: Schemas['UpdateRuleRequestInput'],
  key: string,
) {
  return unwrap(
    api().PATCH('/v1/orgs/{orgId}/rules/{ruleId}', {
      params: { path: { orgId, ruleId } },
      headers: idempotencyHeaders(key),
      body,
    }),
  );
}

export function deleteRule(orgId: string, ruleId: string, key: string) {
  return unwrap(
    api().DELETE('/v1/orgs/{orgId}/rules/{ruleId}', {
      params: { path: { orgId, ruleId } },
      headers: idempotencyHeaders(key),
    }),
  );
}

export function reorderRules(orgId: string, ruleIds: string[], key: string) {
  return unwrap(
    api().POST('/v1/orgs/{orgId}/rules/reorder', {
      params: { path: { orgId } },
      headers: idempotencyHeaders(key),
      body: { ruleIds },
    }),
  );
}

export function applyImportRules(orgId: string, batchId: string, key: string) {
  return unwrap(
    api().POST('/v1/orgs/{orgId}/imports/{batchId}/apply-rules', {
      params: { path: { orgId, batchId } },
      headers: idempotencyHeaders(key),
    }),
  );
}

export function bulkUpdateImportRows(
  orgId: string,
  batchId: string,
  body: Schemas['BulkUpdateImportRowsRequestInput'],
  key: string,
) {
  return unwrap(
    api().POST('/v1/orgs/{orgId}/imports/{batchId}/rows/bulk', {
      params: { path: { orgId, batchId } },
      headers: idempotencyHeaders(key),
      body,
    }),
  );
}

export function previewTransaction(
  orgId: string,
  body: CreateTransactionInput,
  signal?: AbortSignal,
) {
  return unwrap(
    api().POST('/v1/orgs/{orgId}/transactions/preview', {
      params: { path: { orgId } },
      body,
      ...(signal ? { signal } : {}),
    }),
  );
}

export function createTransaction(orgId: string, body: CreateTransactionInput, key: string) {
  return unwrap(
    api().POST('/v1/orgs/{orgId}/transactions', {
      params: { path: { orgId } },
      headers: idempotencyHeaders(key),
      body,
    }),
  );
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
              ...(filters.q ? { q: filters.q } : {}),
              ...(filters.taxable ? { taxable: 'true' as const } : {}),
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
