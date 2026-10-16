import type { BadgeTone } from '@ie-ledger/ui';
import type { Schemas } from './api/client';

// Display labels for API enums. Keyed by the generated types, so a new enum value fails the
// typecheck here instead of showing a raw code.

export const OPERATION_TYPE_LABELS: Record<Schemas['ImportRowView']['operationType'], string> = {
  incoming_payment: 'Incoming payment',
  outgoing_payment: 'Outgoing payment',
  fx_conversion: 'Currency exchange',
  fee: 'Fee',
  other: 'Other',
};

export const TRANSACTION_SOURCE_LABELS: Record<Schemas['TransactionView']['source'], string> = {
  import: 'Import',
  manual: 'Manual',
  invoice_payment: 'Invoice payment',
  reversal: 'Reversal',
};

export const PAYMENT_METHOD_LABELS: Record<
  NonNullable<Schemas['TransactionView']['paymentMethod']>,
  string
> = {
  cash_register: 'Cash register (line 18)',
  pos: 'POS terminal (line 19)',
  bank: 'Bank account (line 20)',
  other: 'Other (line 21)',
};

export const PARSER_LABELS: Record<Schemas['ImportBatch']['bankFormat'], string> = {
  'bog-xlsx': 'Bank of Georgia XLSX',
  'bog-csv': 'Bank of Georgia CSV',
  'tbc-xlsx': 'TBC XLSX',
  'tbc-csv': 'TBC CSV',
  'generic-csv': 'Generic CSV',
};

export const ACCOUNT_MATCH_LABELS: Record<
  Schemas['UploadStatementResponse']['accountMatch'],
  { label: string; detail: string }
> = {
  matched: { label: 'Matched', detail: 'Found by IBAN and currency.' },
  claimed: {
    label: 'Linked',
    detail: 'Your unused default account in this currency now carries the statement IBAN.',
  },
  created: { label: 'New account', detail: 'No account had this IBAN, so one was created.' },
  chosen: { label: 'Chosen', detail: 'The account you picked.' },
};

export const BATCH_STATUS: Record<
  Schemas['ImportBatch']['status'],
  { label: string; tone: BadgeTone }
> = {
  uploaded: { label: 'Uploaded', tone: 'neutral' },
  parsing: { label: 'Reading', tone: 'info' },
  preview: { label: 'Preview', tone: 'warning' },
  committing: { label: 'Booking', tone: 'info' },
  committed: { label: 'Booked', tone: 'positive' },
  failed: { label: 'Failed', tone: 'negative' },
};

export const ROW_STATUS: Record<
  Schemas['ImportRowView']['status'],
  { label: string; tone: BadgeTone }
> = {
  new: { label: 'New', tone: 'accent' },
  duplicate: { label: 'Already booked', tone: 'neutral' },
  skipped: { label: 'Skipped', tone: 'warning' },
};
