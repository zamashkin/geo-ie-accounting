'use client';

import { queryOptions } from '@tanstack/react-query';
import { publicEnv } from '../public-env';
import { browserApi, idempotencyHeaders } from './browser';
import type { Schemas } from './client';
import { unwrap } from './errors';

// Queries and mutations of the client and invoice routes (WS-09) for client components. Every
// mutation takes the Idempotency-Key of the user action.

export type Client = Schemas['ClientView'];
export type ClientInput = Schemas['CreateClientRequestInput'];
export type InvoiceView = Schemas['InvoiceView'];
export type InvoiceSummary = Schemas['InvoiceSummary'];
export type InvoiceInput = Schemas['CreateInvoiceRequestInput'];
export type InvoicePatch = Schemas['UpdateInvoiceRequestInput'];
export type PaymentSuggestion = Schemas['PaymentSuggestion'];
export type InvoiceHint = Schemas['InvoiceHint'];

export const invoiceKeys = {
  clients: (orgId: string) => ['org', orgId, 'clients'] as const,
  invoices: (orgId: string) => ['org', orgId, 'invoices'] as const,
  invoice: (orgId: string, invoiceId: string) => ['org', orgId, 'invoices', invoiceId] as const,
  suggestions: (orgId: string, invoiceId: string) =>
    ['org', orgId, 'invoices', invoiceId, 'suggestions'] as const,
  transactionHints: (orgId: string, transactionId: string) =>
    ['org', orgId, 'invoices', 'hints', 'transaction', transactionId] as const,
  importHints: (orgId: string, batchId: string) =>
    ['org', orgId, 'invoices', 'hints', 'import', batchId] as const,
};

const api = () => browserApi();

/** Where the browser downloads the PDF: the API itself, with the session cookie. */
export function invoicePdfUrl(orgId: string, invoiceId: string, inline = false): string {
  const base = publicEnv().apiUrl.replace(/\/$/, '');
  return `${base}/v1/orgs/${orgId}/invoices/${invoiceId}/pdf${inline ? '?inline=true' : ''}`;
}

/** Every client, archived ones included (pickers filter them out). */
export function clientsQuery(orgId: string) {
  return queryOptions({
    queryKey: invoiceKeys.clients(orgId),
    queryFn: async ({ signal }) =>
      (
        await unwrap(
          api().GET('/v1/orgs/{orgId}/clients', {
            params: { path: { orgId }, query: { includeArchived: 'true' } },
            signal,
          }),
        )
      ).items,
  });
}

export function createClient(orgId: string, body: ClientInput, key: string) {
  return unwrap(
    api().POST('/v1/orgs/{orgId}/clients', {
      params: { path: { orgId } },
      headers: idempotencyHeaders(key),
      body,
    }),
  );
}

export function updateClient(
  orgId: string,
  clientId: string,
  body: Schemas['UpdateClientRequestInput'],
  key: string,
) {
  return unwrap(
    api().PATCH('/v1/orgs/{orgId}/clients/{clientId}', {
      params: { path: { orgId, clientId } },
      headers: idempotencyHeaders(key),
      body,
    }),
  );
}

export function createInvoice(orgId: string, body: InvoiceInput, key: string) {
  return unwrap(
    api().POST('/v1/orgs/{orgId}/invoices', {
      params: { path: { orgId } },
      headers: idempotencyHeaders(key),
      body,
    }),
  );
}

export function updateInvoice(orgId: string, invoiceId: string, body: InvoicePatch, key: string) {
  return unwrap(
    api().PATCH('/v1/orgs/{orgId}/invoices/{invoiceId}', {
      params: { path: { orgId, invoiceId } },
      headers: idempotencyHeaders(key),
      body,
    }),
  );
}

export function deleteInvoice(orgId: string, invoiceId: string, key: string) {
  return unwrap(
    api().DELETE('/v1/orgs/{orgId}/invoices/{invoiceId}', {
      params: { path: { orgId, invoiceId } },
      headers: idempotencyHeaders(key),
    }),
  );
}

export function issueInvoice(
  orgId: string,
  invoiceId: string,
  body: Schemas['IssueInvoiceRequestInput'],
  key: string,
) {
  return unwrap(
    api().POST('/v1/orgs/{orgId}/invoices/{invoiceId}/issue', {
      params: { path: { orgId, invoiceId } },
      headers: idempotencyHeaders(key),
      body,
    }),
  );
}

export function voidInvoice(orgId: string, invoiceId: string, reason: string, key: string) {
  return unwrap(
    api().POST('/v1/orgs/{orgId}/invoices/{invoiceId}/void', {
      params: { path: { orgId, invoiceId } },
      headers: idempotencyHeaders(key),
      body: reason ? { reason } : {},
    }),
  );
}

export function duplicateInvoice(orgId: string, invoiceId: string, key: string) {
  return unwrap(
    api().POST('/v1/orgs/{orgId}/invoices/{invoiceId}/duplicate', {
      params: { path: { orgId, invoiceId } },
      headers: idempotencyHeaders(key),
    }),
  );
}

export function paymentSuggestionsQuery(orgId: string, invoiceId: string) {
  return queryOptions({
    queryKey: invoiceKeys.suggestions(orgId, invoiceId),
    queryFn: async ({ signal }) =>
      (
        await unwrap(
          api().GET('/v1/orgs/{orgId}/invoices/{invoiceId}/payment-suggestions', {
            params: { path: { orgId, invoiceId } },
            signal,
          }),
        )
      ).items,
  });
}

export function matchPayment(
  orgId: string,
  invoiceId: string,
  body: Schemas['MatchPaymentRequestInput'],
  key: string,
) {
  return unwrap(
    api().POST('/v1/orgs/{orgId}/invoices/{invoiceId}/match-payment', {
      params: { path: { orgId, invoiceId } },
      headers: idempotencyHeaders(key),
      body,
    }),
  );
}

export function unmatchPayment(
  orgId: string,
  invoiceId: string,
  transactionId: string,
  key: string,
) {
  return unwrap(
    api().DELETE('/v1/orgs/{orgId}/invoices/{invoiceId}/payments/{transactionId}', {
      params: { path: { orgId, invoiceId, transactionId } },
      headers: idempotencyHeaders(key),
    }),
  );
}

export function transactionInvoiceHintsQuery(orgId: string, transactionId: string) {
  return queryOptions({
    queryKey: invoiceKeys.transactionHints(orgId, transactionId),
    queryFn: ({ signal }) =>
      unwrap(
        api().GET('/v1/orgs/{orgId}/transactions/{transactionId}/invoice-hints', {
          params: { path: { orgId, transactionId } },
          signal,
        }),
      ),
  });
}

export function importInvoiceHintsQuery(orgId: string, batchId: string) {
  return queryOptions({
    queryKey: invoiceKeys.importHints(orgId, batchId),
    queryFn: async ({ signal }) =>
      (
        await unwrap(
          api().GET('/v1/orgs/{orgId}/imports/{batchId}/invoice-hints', {
            params: { path: { orgId, batchId } },
            signal,
          }),
        )
      ).items,
    staleTime: 60_000,
  });
}
