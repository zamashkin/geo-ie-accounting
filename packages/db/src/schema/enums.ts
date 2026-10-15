import {
  ACCOUNT_KINDS,
  ACCOUNTING_METHODS,
  BANKS,
  DECLARATION_STATUSES,
  IMPORT_BATCH_STATUSES,
  IMPORT_ROW_STATUSES,
  INCOME_CLASSES,
  INVOICE_STATUSES,
  OPERATION_TYPES,
  PARSER_IDS,
  PAYMENT_METHODS,
  ROLES,
  RULE_FIELDS,
  RULE_OPS,
  TRANSACTION_SOURCES,
} from '@ie-ledger/contracts';
import { pgEnum } from 'drizzle-orm/pg-core';

// Values come from packages/contracts so the DB and the API cannot drift.

export const roleEnum = pgEnum('role', ROLES);
export const accountingMethodEnum = pgEnum('accounting_method', ACCOUNTING_METHODS);
export const accountKindEnum = pgEnum('account_kind', ACCOUNT_KINDS);
export const incomeClassEnum = pgEnum('income_class', INCOME_CLASSES);
export const bankEnum = pgEnum('bank', BANKS);
export const transactionSourceEnum = pgEnum('transaction_source', TRANSACTION_SOURCES);
export const paymentMethodEnum = pgEnum('payment_method', PAYMENT_METHODS);
export const parserIdEnum = pgEnum('parser_id', PARSER_IDS);
export const importBatchStatusEnum = pgEnum('import_batch_status', IMPORT_BATCH_STATUSES);
export const importRowStatusEnum = pgEnum('import_row_status', IMPORT_ROW_STATUSES);
export const operationTypeEnum = pgEnum('operation_type', OPERATION_TYPES);
export const ruleFieldEnum = pgEnum('rule_field', RULE_FIELDS);
export const ruleOpEnum = pgEnum('rule_op', RULE_OPS);
export const invoiceStatusEnum = pgEnum('invoice_status', INVOICE_STATUSES);
export const declarationStatusEnum = pgEnum('declaration_status', DECLARATION_STATUSES);
