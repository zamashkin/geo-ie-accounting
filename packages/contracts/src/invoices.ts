import { z } from 'zod';
import { Client, Invoice, InvoiceLine } from './entities';
import { InvoiceStatus } from './enums';
import { PaginationQuery, paginated } from './pagination';
import {
  CurrencyCode,
  IsoDate,
  MinorUnits,
  PositiveMinorUnits,
  QuantityDecimal,
  Timestamp,
  Uuid,
} from './primitives';
import { OptionalText, OrgParams } from './tenancy';

// Clients and invoices (WS-09) under /v1/orgs/:orgId/{clients,invoices}, and the "possible
// invoice" hints on transactions and import rows. Invoices never post to the ledger: income is
// still what the bank receipts book. Totals come from packages/domain (computeInvoiceTotals).

// ── Clients ─────────────────────────────────────────────────────────────────────────────

export const ClientParams = OrgParams.extend({ clientId: Uuid });
export type ClientParams = z.output<typeof ClientParams>;

const ClientFields = {
  name: z.string().trim().min(1, 'Enter a name').max(200),
  taxId: OptionalText(50),
  address: OptionalText(500),
  email: z
    .union([z.email().max(254), z.literal('')])
    .nullable()
    .optional()
    .transform((v) => (v === '' ? null : v)),
  /** ISO 3166-1 alpha-2, e.g. `GE`, `DE`, `US`. */
  country: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/, 'Use the two-letter country code'),
  /** New invoices for the client start in this currency. */
  defaultCurrency: CurrencyCode,
  notes: OptionalText(2000),
};

export const CreateClientRequest = z.object(ClientFields).meta({ id: 'CreateClientRequest' });
export type CreateClientRequest = z.output<typeof CreateClientRequest>;

/** `PATCH /clients/:clientId`: only the fields sent change. `archived` hides or restores it. */
export const UpdateClientRequest = z
  .object({ ...ClientFields, archived: z.boolean() })
  .partial()
  .refine((b) => Object.values(b).some((v) => v !== undefined), {
    message: 'Send at least one field',
  })
  .meta({ id: 'UpdateClientRequest' });
export type UpdateClientRequest = z.output<typeof UpdateClientRequest>;

export const ListClientsQuery = z.object({
  includeArchived: z.enum(['true', 'false']).optional(),
});
export type ListClientsQuery = z.output<typeof ListClientsQuery>;

/** An amount per currency (invoices are never converted to GEL). */
export const CurrencyAmount = z
  .object({ currency: CurrencyCode, amountMinor: MinorUnits })
  .meta({ id: 'CurrencyAmount' });
export type CurrencyAmount = z.output<typeof CurrencyAmount>;

/** A client with what its issued invoices still owe, per currency. */
export const ClientView = Client.extend({
  /** Issued, paid and void invoices; drafts not counted. */
  invoiceCount: z.int().nonnegative(),
  /** Outstanding on issued invoices, one entry per currency with something owed. */
  outstanding: z.array(CurrencyAmount),
  /** Of those, how many are past their due date. */
  overdueCount: z.int().nonnegative(),
}).meta({ id: 'ClientView' });
export type ClientView = z.output<typeof ClientView>;

/** Name order. Not paginated: an entrepreneur has tens of clients, not thousands. */
export const ClientList = z.object({ items: z.array(ClientView) }).meta({ id: 'ClientList' });
export type ClientList = z.output<typeof ClientList>;

// ── Invoices ────────────────────────────────────────────────────────────────────────────

export const InvoiceParams = OrgParams.extend({ invoiceId: Uuid });
export type InvoiceParams = z.output<typeof InvoiceParams>;

export const InvoicePaymentParams = InvoiceParams.extend({ transactionId: Uuid });
export type InvoicePaymentParams = z.output<typeof InvoicePaymentParams>;

export const MAX_INVOICE_LINES = 200;

export const InvoiceLineRequest = z
  .object({
    description: z.string().trim().min(1, 'Describe the line').max(1000),
    /** Decimal string with up to 3 decimals, greater than zero: `"1"`, `"2.5"`, `"0.125"`. */
    quantity: QuantityDecimal.refine((q) => /[1-9]/.test(q), 'Quantity must be above zero'),
    /** Minor units of the invoice currency, zero or more. */
    unitPriceMinor: MinorUnits.refine((v) => v >= 0n, 'The price cannot be negative'),
  })
  .meta({ id: 'InvoiceLineRequest' });
export type InvoiceLineRequest = z.output<typeof InvoiceLineRequest>;

const DraftFields = {
  clientId: Uuid,
  /** Default: the client's default currency. */
  currency: CurrencyCode,
  /** Optional on a draft; issuing defaults it to today (Tbilisi). */
  issueDate: IsoDate.nullable(),
  /** Optional on a draft; issuing defaults it to issue date + the org's `invoiceDueDays`. */
  dueDate: IsoDate.nullable(),
  /** Bank account whose IBAN is printed for payment. */
  bankAccountId: Uuid.nullable(),
  notes: OptionalText(2000),
  /** Replaces every line, in order. */
  lines: z.array(InvoiceLineRequest).max(MAX_INVOICE_LINES),
};

const datesInOrder = (b: {
  issueDate?: string | null | undefined;
  dueDate?: string | null | undefined;
}) => !b.issueDate || !b.dueDate || b.issueDate <= b.dueDate;
const datesMessage = { message: 'The due date cannot be before the issue date', path: ['dueDate'] };

/** `POST /invoices`: a new draft. Nothing is numbered until it is issued. */
export const CreateInvoiceRequest = z
  .object({
    ...DraftFields,
    currency: DraftFields.currency.optional(),
    issueDate: DraftFields.issueDate.optional(),
    dueDate: DraftFields.dueDate.optional(),
    bankAccountId: DraftFields.bankAccountId.optional(),
    lines: DraftFields.lines.default([]),
  })
  .refine(datesInOrder, datesMessage)
  .meta({ id: 'CreateInvoiceRequest' });
export type CreateInvoiceRequest = z.output<typeof CreateInvoiceRequest>;

/** `PATCH /invoices/:invoiceId`: drafts only; only the fields sent change. */
export const UpdateInvoiceRequest = z
  .object(DraftFields)
  .partial()
  .refine(datesInOrder, datesMessage)
  .meta({ id: 'UpdateInvoiceRequest' });
export type UpdateInvoiceRequest = z.output<typeof UpdateInvoiceRequest>;

/**
 * `POST /invoices/:invoiceId/issue`: assigns the next number of the issue year and freezes the
 * invoice. The dates sent here win over the draft's; send `{}` for the draft's or the defaults.
 */
export const IssueInvoiceRequest = z
  .object({ issueDate: IsoDate.optional(), dueDate: IsoDate.optional() })
  .refine(datesInOrder, datesMessage)
  .meta({ id: 'IssueInvoiceRequest' });
export type IssueInvoiceRequest = z.output<typeof IssueInvoiceRequest>;

/** `POST /invoices/:invoiceId/void`. The number stays taken. */
export const VoidInvoiceRequest = z
  .object({ reason: z.string().trim().max(500).optional() })
  .meta({ id: 'VoidInvoiceRequest' });
export type VoidInvoiceRequest = z.output<typeof VoidInvoiceRequest>;

/** Status filter of the list: a stored status, or `overdue` (issued and past due). */
export const INVOICE_LIST_FILTERS = ['draft', 'issued', 'overdue', 'paid', 'void'] as const;
export const InvoiceListFilter = z.enum(INVOICE_LIST_FILTERS);
export type InvoiceListFilter = z.output<typeof InvoiceListFilter>;

export const ListInvoicesQuery = PaginationQuery.extend({
  status: InvoiceListFilter.optional(),
  clientId: Uuid.optional(),
});
export type ListInvoicesQuery = z.output<typeof ListInvoicesQuery>;

/** Seller and buyer details as printed: frozen at issue, live while draft. */
export const InvoiceParty = z
  .object({
    name: z.string(),
    taxId: z.string().nullable(),
    address: z.string().nullable(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    country: z.string().nullable(),
  })
  .meta({ id: 'InvoiceParty' });
export type InvoiceParty = z.output<typeof InvoiceParty>;

export const InvoiceBankDetails = z
  .object({
    accountName: z.string(),
    bank: z.string().nullable(),
    iban: z.string().nullable(),
    currency: CurrencyCode.nullable(),
  })
  .meta({ id: 'InvoiceBankDetails' });
export type InvoiceBankDetails = z.output<typeof InvoiceBankDetails>;

/** What an issued invoice froze, so a later client or profile edit cannot change it. */
export const InvoiceSnapshot = z
  .object({
    seller: InvoiceParty,
    client: InvoiceParty,
    bank: InvoiceBankDetails.nullable(),
    note: z.string().nullable(),
  })
  .meta({ id: 'InvoiceSnapshot' });
export type InvoiceSnapshot = z.output<typeof InvoiceSnapshot>;

/** An invoice in a list, with its money figures. */
export const InvoiceSummary = Invoice.extend({
  clientName: z.string(),
  paidMinor: MinorUnits,
  /** total − paid on an issued invoice; zero once paid, void or still a draft. */
  outstandingMinor: MinorUnits,
  /** Issued and past its due date (Tbilisi today). */
  overdue: z.boolean(),
}).meta({ id: 'InvoiceSummary' });
export type InvoiceSummary = z.output<typeof InvoiceSummary>;

export const InvoiceList = paginated(InvoiceSummary).meta({ id: 'InvoiceList' });
export type InvoiceList = z.output<typeof InvoiceList>;

export const InvoiceLineView = InvoiceLine.extend({
  /** quantity × unit price, rounded half up to the minor unit (domain invoiceLineTotal). */
  lineTotalMinor: MinorUnits,
}).meta({ id: 'InvoiceLineView' });
export type InvoiceLineView = z.output<typeof InvoiceLineView>;

/** A payment allocated to an invoice, with the bank line it came from. */
export const InvoicePaymentView = z
  .object({
    transactionId: Uuid,
    amountMinor: MinorUnits,
    occurredOn: IsoDate,
    description: z.string(),
    counterparty: z.string().nullable(),
    createdAt: Timestamp,
  })
  .meta({ id: 'InvoicePaymentView' });
export type InvoicePaymentView = z.output<typeof InvoicePaymentView>;

export const InvoiceView = InvoiceSummary.extend({
  client: Client,
  lines: z.array(InvoiceLineView),
  payments: z.array(InvoicePaymentView),
  /** The details the PDF prints: the frozen snapshot once issued, live ones on a draft. */
  parties: InvoiceSnapshot,
}).meta({ id: 'InvoiceView' });
export type InvoiceView = z.output<typeof InvoiceView>;

/** `GET /invoices/summary`: what clients owe, per currency (never converted). */
export const InvoiceCurrencyTotals = z
  .object({
    currency: CurrencyCode,
    outstandingMinor: MinorUnits,
    outstandingCount: z.int().nonnegative(),
    overdueMinor: MinorUnits,
    overdueCount: z.int().nonnegative(),
  })
  .meta({ id: 'InvoiceCurrencyTotals' });
export type InvoiceCurrencyTotals = z.output<typeof InvoiceCurrencyTotals>;

export const InvoiceSummaryTotals = z
  .object({
    /** Tbilisi date overdue is judged on. */
    today: IsoDate,
    /** By currency code; amounts in different currencies are never added up. */
    byCurrency: z.array(InvoiceCurrencyTotals),
    outstandingCount: z.int().nonnegative(),
    overdueCount: z.int().nonnegative(),
    draftCount: z.int().nonnegative(),
  })
  .meta({ id: 'InvoiceSummaryTotals' });
export type InvoiceSummaryTotals = z.output<typeof InvoiceSummaryTotals>;

// ── Payment matching ────────────────────────────────────────────────────────────────────

export const AmountMatch = z.enum(['exact', 'partial', 'over']).meta({
  id: 'AmountMatch',
  description:
    '`exact`: the payment equals what is owed. `partial`: less. `over`: more (one transfer ' +
    'for several invoices); only what is owed is allocated.',
});
export type AmountMatch = z.output<typeof AmountMatch>;

const MatchFigures = {
  /** 0..100: amount, counterparty vs client name, and timing (domain scorePaymentMatch). */
  score: z.int().min(0).max(100),
  amountMatch: AmountMatch,
  /** Counterparty vs client name, 0..100; null when the bank line has no counterparty. */
  nameScore: z.int().min(0).max(100).nullable(),
  /** What confirming allocates: the smaller of the unallocated payment and the outstanding. */
  allocateMinor: MinorUnits,
};

/** An incoming imported bank line that could pay the invoice. */
export const PaymentSuggestion = z
  .object({
    transactionId: Uuid,
    occurredOn: IsoDate,
    /** The incoming amount on the bank account. */
    amountMinor: MinorUnits,
    currency: CurrencyCode,
    /** Not yet allocated to any invoice. */
    unallocatedMinor: MinorUnits,
    counterparty: z.string().nullable(),
    description: z.string(),
    ...MatchFigures,
  })
  .meta({ id: 'PaymentSuggestion' });
export type PaymentSuggestion = z.output<typeof PaymentSuggestion>;

export const PaymentSuggestionList = z
  .object({ items: z.array(PaymentSuggestion) })
  .meta({ id: 'PaymentSuggestionList' });
export type PaymentSuggestionList = z.output<typeof PaymentSuggestionList>;

/**
 * `POST /invoices/:invoiceId/match-payment`: allocates (part of) an incoming imported bank
 * transaction to an issued invoice. Default amount: the smaller of what is unallocated and what
 * is owed. The invoice becomes `paid` once its payments cover the total.
 */
export const MatchPaymentRequest = z
  .object({ transactionId: Uuid, amountMinor: PositiveMinorUnits.optional() })
  .meta({ id: 'MatchPaymentRequest' });
export type MatchPaymentRequest = z.output<typeof MatchPaymentRequest>;

/** An open invoice an incoming payment could settle. */
export const InvoiceHint = z
  .object({
    invoiceId: Uuid,
    number: z.string(),
    clientName: z.string(),
    currency: CurrencyCode,
    outstandingMinor: MinorUnits,
    dueDate: IsoDate.nullable(),
    ...MatchFigures,
  })
  .meta({ id: 'InvoiceHint' });
export type InvoiceHint = z.output<typeof InvoiceHint>;

/** `GET /transactions/:transactionId/invoice-hints`. */
export const TransactionInvoiceHints = z
  .object({
    /** Invoices this transaction already pays. */
    allocations: z.array(
      z.object({
        invoiceId: Uuid,
        number: z.string().nullable(),
        clientName: z.string(),
        status: InvoiceStatus,
        amountMinor: MinorUnits,
        currency: CurrencyCode,
      }),
    ),
    /** Open invoices the unallocated rest could pay, best first. Empty for outgoing lines. */
    suggestions: z.array(InvoiceHint),
  })
  .meta({ id: 'TransactionInvoiceHints' });
export type TransactionInvoiceHints = z.output<typeof TransactionInvoiceHints>;

/** `GET /imports/:batchId/invoice-hints`: incoming rows of the preview that fit an open invoice. */
export const ImportInvoiceHints = z
  .object({
    items: z.array(z.object({ rowId: Uuid, invoices: z.array(InvoiceHint).max(3) })),
  })
  .meta({ id: 'ImportInvoiceHints' });
export type ImportInvoiceHints = z.output<typeof ImportInvoiceHints>;
