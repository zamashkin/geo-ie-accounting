// Row → wire DTO mappers shared by the ledger routes. Shapes come from packages/contracts.
import type {
  Account,
  CategorizationRule,
  ImportBatch,
  ImportRowView,
  TransactionView,
} from '@geo-ie-accounting/contracts';
import type {
  AccountRow,
  ImportBatchRow,
  ImportRowRow,
  RuleRow,
  TransactionDetail,
} from '@geo-ie-accounting/db';
import { formatRate, parseRate } from '@geo-ie-accounting/domain';
import type { z } from 'zod';
import { HttpProblem } from '../problem';

/** A bank (or cash) account: an asset in one currency that is not a system account. */
export function isBankAccount(
  a: Pick<AccountRow, 'kind' | 'currency' | 'systemKey'>,
): a is typeof a & { currency: string } {
  return a.kind === 'asset' && a.currency !== null && a.systemKey === null;
}

export function toAccountDto(a: AccountRow): Account {
  return {
    id: a.id,
    orgId: a.orgId,
    name: a.name,
    kind: a.kind,
    currency: a.currency,
    systemKey: a.systemKey,
    incomeClass: a.incomeClass,
    bank: a.bank,
    iban: a.iban,
    archivedAt: a.archivedAt?.toISOString() ?? null,
    createdAt: a.createdAt.toISOString(),
  };
}

export function toImportBatchDto(b: ImportBatchRow): ImportBatch {
  return {
    id: b.id,
    orgId: b.orgId,
    accountId: b.accountId,
    bankFormat: b.bankFormat,
    fileKey: b.fileKey,
    fileSha256: b.fileSha256,
    fileName: b.fileName,
    status: b.status,
    stats: b.stats,
    warnings: b.warnings,
    periodFrom: b.periodFrom,
    periodTo: b.periodTo,
    error: b.error ?? null,
    createdBy: b.createdBy,
    createdAt: b.createdAt.toISOString(),
    updatedAt: b.updatedAt.toISOString(),
  };
}

export function toImportRowDto(r: ImportRowRow): ImportRowView {
  return {
    id: r.id,
    batchId: r.batchId,
    orgId: r.orgId,
    rowIndex: r.rowIndex,
    bookedOn: r.bookedOn,
    amountMinor: r.amountMinor,
    currency: r.currency,
    counterparty: r.counterparty,
    counterpartyAccount: r.counterpartyAccount,
    description: r.description,
    bankReference: r.bankReference,
    documentNumber: r.documentNumber,
    operationType: r.operationType,
    bankGelAmountMinor: r.bankGelAmountMinor,
    counterAmountMinor: r.counterAmountMinor,
    counterCurrency: r.counterCurrency,
    dedupeHash: r.dedupeHash,
    status: r.status,
    suggestedAccountId: r.suggestedAccountId,
    suggestedRuleId: r.suggestedRuleId,
    chosenAccountId: r.chosenAccountId,
    accountId: r.chosenAccountId ?? r.suggestedAccountId,
    transactionId: r.transactionId,
  };
}

export function toRuleDto(r: RuleRow): CategorizationRule {
  return {
    id: r.id,
    orgId: r.orgId,
    name: r.name,
    priority: r.priority,
    counterpartyContains: r.counterpartyContains,
    descriptionContains: r.descriptionContains,
    direction: r.direction,
    currency: r.currency,
    amountMinMinor: r.amountMinMinor,
    amountMaxMinor: r.amountMaxMinor,
    targetAccountId: r.targetAccountId,
    isActive: r.isActive,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export function toTransactionDto(t: TransactionDetail): TransactionView {
  return {
    id: t.id,
    orgId: t.orgId,
    occurredOn: t.occurredOn,
    description: t.description,
    notes: t.notes,
    source: t.source,
    paymentMethod: t.paymentMethod,
    reversesId: t.reversesId,
    importBatchId: t.importBatchId,
    createdBy: t.createdBy,
    createdAt: t.createdAt.toISOString(),
    reversedById: t.reversedById,
    postings: t.postings.map((p) => ({
      id: p.id,
      transactionId: p.transactionId,
      orgId: p.orgId,
      accountId: p.accountId,
      amountMinor: p.amountMinor,
      currency: p.currency,
      gelAmountMinor: p.gelAmountMinor,
      rateId: p.rateId,
      account: p.account,
      // numeric(18,6) comes back as "3.692400"; show it as NBG prints it.
      rate: p.rate && { ...p.rate, rate: formatRate(parseRate(p.rate.rate)) },
    })),
  };
}

// ── Opaque keyset cursors: base64url JSON ───────────────────────────────────────────────

export function encodeCursor(value: Record<string, string | number>): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

export function decodeCursor<T>(cursor: string | undefined, schema: z.ZodType<T>): T | undefined {
  if (cursor === undefined) return undefined;
  try {
    return schema.parse(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')));
  } catch {
    throw new HttpProblem(400, 'validation_failed', 'Invalid cursor.', [
      { path: 'querystring/cursor', message: 'Invalid cursor' },
    ]);
  }
}
