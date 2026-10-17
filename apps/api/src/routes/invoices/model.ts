// Row → DTO mapping and loaders shared by the client and invoice routes. Totals, outstanding
// and overdue come from packages/domain; shapes from packages/contracts.
import type {
  Client,
  InvoiceBankDetails,
  InvoiceParty,
  InvoiceSnapshot,
  InvoiceSummary,
  InvoiceView,
} from '@ie-ledger/contracts';
import {
  getAccount,
  getClient,
  getInvoice,
  getOrganization,
  listInvoiceLines,
  listInvoicePayments,
  type AccountRow,
  type ClientRow,
  type DbOrTx,
  type InvoiceListRow,
  type OrganizationRow,
} from '@ie-ledger/db';
import {
  computeInvoiceTotals,
  invoiceOutstanding,
  isInvoiceOverdue,
  isSupportedCurrency,
  SUPPORTED_CURRENCIES,
} from '@ie-ledger/domain';
import { HttpProblem } from '../../problem';
import { isBankAccount } from '../dto';

export function toClientDto(c: ClientRow): Client {
  return {
    id: c.id,
    orgId: c.orgId,
    name: c.name,
    taxId: c.taxId,
    address: c.address,
    email: c.email,
    country: c.country,
    defaultCurrency: c.defaultCurrency,
    notes: c.notes,
    archivedAt: c.archivedAt?.toISOString() ?? null,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

/** Only an issued invoice is owed: a draft is not sent yet, paid and void owe nothing. */
export function outstandingOf(row: Pick<InvoiceListRow, 'status' | 'totalMinor' | 'paidMinor'>) {
  return row.status === 'issued' ? invoiceOutstanding(row.totalMinor, row.paidMinor) : 0n;
}

export function toInvoiceSummaryDto(row: InvoiceListRow, today: string): InvoiceSummary {
  return {
    id: row.id,
    orgId: row.orgId,
    clientId: row.clientId,
    number: row.number,
    numberYear: row.numberYear,
    numberSeq: row.numberSeq,
    issueDate: row.issueDate,
    dueDate: row.dueDate,
    currency: row.currency,
    status: row.status,
    bankAccountId: row.bankAccountId,
    notes: row.notes,
    totalMinor: row.totalMinor,
    issuedAt: row.issuedAt?.toISOString() ?? null,
    voidedAt: row.voidedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    clientName: row.clientName,
    paidMinor: row.paidMinor,
    outstandingMinor: outstandingOf(row),
    overdue: isInvoiceOverdue(row, today),
  };
}

const BANK_NAMES = { bog: 'Bank of Georgia', tbc: 'TBC Bank', other: null } as const;

export function sellerParty(org: OrganizationRow): InvoiceParty {
  return {
    name: org.name,
    taxId: org.taxId,
    address: org.address,
    email: org.email,
    phone: org.phone,
    country: 'GE',
  };
}

export function clientParty(c: ClientRow): InvoiceParty {
  return {
    name: c.name,
    taxId: c.taxId,
    address: c.address,
    email: c.email,
    phone: null,
    country: c.country,
  };
}

export function bankDetails(a: AccountRow | null): InvoiceBankDetails | null {
  if (!a) return null;
  return {
    accountName: a.name,
    bank: a.bank ? BANK_NAMES[a.bank] : null,
    iban: a.iban,
    currency: a.currency,
  };
}

/** What the invoice prints now: the org, client and bank account as they are today. */
export async function liveSnapshot(
  db: DbOrTx,
  orgId: string,
  inv: { clientId: string; bankAccountId: string | null },
): Promise<InvoiceSnapshot> {
  // Sequential: `db` may be the request transaction, one connection that runs one query at a time.
  const org = await getOrganization(db, orgId);
  const client = await getClient(db, orgId, inv.clientId);
  const bank = inv.bankAccountId ? await getAccount(db, orgId, inv.bankAccountId) : null;
  if (!org || !client) throw new Error('invoice without its organization or client');
  return {
    seller: sellerParty(org),
    client: clientParty(client),
    bank: bankDetails(bank),
    note: org.invoiceNote,
  };
}

/** The full invoice: lines with their totals, payments, client and the printed details. */
export async function loadInvoiceView(
  db: DbOrTx,
  orgId: string,
  invoiceId: string,
  today: string,
): Promise<InvoiceView | null> {
  const row = await getInvoice(db, orgId, invoiceId);
  if (!row) return null;
  const lines = await listInvoiceLines(db, orgId, invoiceId);
  const payments = await listInvoicePayments(db, orgId, invoiceId);
  const client = await getClient(db, orgId, row.clientId);
  if (!client) throw new Error('invoice without its client');
  const totals = computeInvoiceTotals(row.currency, lines);
  return {
    ...toInvoiceSummaryDto(row, today),
    client: toClientDto(client),
    lines: lines.map((l, i) => ({
      id: l.id,
      invoiceId: l.invoiceId,
      orgId: l.orgId,
      position: l.position,
      description: l.description,
      // numeric(12,3) comes back as "2.500"; show it the way it was typed.
      quantity: trimQuantity(l.quantity),
      unitPriceMinor: l.unitPriceMinor,
      lineTotalMinor: totals.lineTotalsMinor[i] ?? 0n,
    })),
    payments: payments.map((p) => ({
      transactionId: p.transactionId,
      amountMinor: p.amountMinor,
      occurredOn: p.occurredOn,
      description: p.description,
      counterparty: p.counterparty,
      createdAt: p.createdAt.toISOString(),
    })),
    parties: row.snapshot ?? (await liveSnapshot(db, orgId, row)),
  };
}

/** `"2.500"` → `"2.5"`, `"3.000"` → `"3"`. */
export function trimQuantity(q: string): string {
  return q.includes('.') ? q.replace(/\.?0+$/, '') : q;
}

export function assertCurrency(currency: string, path: string) {
  if (!isSupportedCurrency(currency)) {
    throw new HttpProblem(422, 'validation_failed', 'This currency is not supported.', [
      { path, message: `Use one of ${SUPPORTED_CURRENCIES.join(', ')}` },
    ]);
  }
}

/** The client must be the org's and not archived (for new invoices). */
export async function requireClient(db: DbOrTx, orgId: string, clientId: string) {
  const client = await getClient(db, orgId, clientId);
  if (!client) {
    throw new HttpProblem(422, 'validation_failed', 'The client does not exist.', [
      { path: 'body/clientId', message: 'Choose a client' },
    ]);
  }
  return client;
}

/** A bank account of the org (asset, with a currency, not a system account), not archived. */
export async function requireBankAccount(db: DbOrTx, orgId: string, accountId: string) {
  const account = await getAccount(db, orgId, accountId);
  if (!account || !isBankAccount(account) || account.archivedAt !== null) {
    throw new HttpProblem(422, 'validation_failed', 'Choose one of your bank accounts.', [
      { path: 'body/bankAccountId', message: 'Choose one of your bank accounts' },
    ]);
  }
  return account;
}
