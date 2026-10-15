// Bank of Georgia CSV statement: a printed report saved as CSV, not a flat table. See bog/FORMAT.md.
//
// Headers and labels are Georgian typed in the legacy Latin "font" transliteration (AcadNusx-style
// keyboard mapping). They are matched exactly and case-sensitively: `T` and `t` are different
// Georgian letters (`TariRi` = თარიღი, date).

import type { OperationType, ParsedRow, ParseOptions, StatementMeta } from '@ie-ledger/contracts';
import type { CsvRecord } from '../lib/csv';
import { isBlankRecord, parseCsv } from '../lib/csv';
import { isCurrencyCode } from '../lib/currency';
import { parseDate } from '../lib/dates';
import type { DecimalParts } from '../lib/decimal';
import { isZero, parseDecimal } from '../lib/decimal';
import { blankToNull, collapseLines, decodeText, looksBinary, swiftName } from '../lib/text';
import type { StatementParser } from '../parser';
import { EMPTY_META, safeDetect, safeParse } from '../parser';
import type { Warnings } from '../warnings';
import {
  checkDirection,
  counterAmountFromText,
  finish,
  incomingTransferFields,
  isOwnOtherCurrencyAccount,
  minorOf,
  parseAccountField,
  parsePeriod,
  statementCurrency,
} from './common';

const HEADERS = {
  date: 'TariRi', // date
  docN: 'sabuTis #', // document number
  loro: 'mokorespondento angariSi', // correspondent account
  debit: 'debeti',
  credit: 'krediti',
  rate: 'kursi',
  gel: 'eqv.lari', // GEL equivalent
  description: 'operaciis Sinaarsi', // operation content
} as const;
type Column = keyof typeof HEADERS;

/** Report rows that are not transactions. */
const LABEL = {
  opening: 'sawyisi naSTi', // opening balance (in the doc # column)
  closing: 'saboloo naSTi', // closing balance (in the doc # column)
  dayTurnover: 'brunva', // daily turnover
  dayBalance: 'naSTi', // daily balance
  totalTurnover: 'sul brunva', // total turnover
} as const;

const META = {
  account: 'angariSis #:', // account no.
  period: 'periodi:', // period
} as const;

const CONVERSION_TEXT = /Foreign Exchange|Currency Exchange|Counter-amount/;

interface Layout {
  headerIndex: number;
  columns: Map<Column, number>;
  headerNames: string[];
}

function findHeader(records: readonly CsvRecord[]): Layout | null {
  for (let i = 0; i < records.length; i++) {
    const cells = (records[i]?.cells ?? []).map((c) => c.trim());
    if (
      cells[0] !== HEADERS.date ||
      !cells.includes(HEADERS.debit) ||
      !cells.includes(HEADERS.credit)
    )
      continue;
    const columns = new Map<Column, number>();
    for (const [key, name] of Object.entries(HEADERS) as [Column, string][]) {
      const c = cells.indexOf(name);
      if (c !== -1) columns.set(key, c);
    }
    return { headerIndex: i, columns, headerNames: cells };
  }
  return null;
}

function readMeta(records: readonly CsvRecord[], headerIndex: number) {
  let account = { iban: null as string | null, currency: null as string | null };
  let period = { from: null as string | null, to: null as string | null };
  for (let i = 0; i < headerIndex; i++) {
    for (const cell of records[i]?.cells ?? []) {
      const t = cell.trim();
      if (t.startsWith(META.account)) account = parseAccountField(t.slice(META.account.length));
      else if (t.startsWith(META.period)) period = parsePeriod(t.slice(META.period.length));
    }
  }
  return { account, period };
}

function parseImpl(
  file: Uint8Array,
  opts: ParseOptions,
  warnings: Warnings,
): { meta: StatementMeta; rows: ParsedRow[] } {
  if (looksBinary(file)) {
    warnings.add('unreadable_file', 'The file is not a text CSV.');
    return { meta: EMPTY_META, rows: [] };
  }
  const decoded = decodeText(file);
  if (decoded.fallback)
    warnings.add('encoding_fallback', 'The file is not UTF-8; it was read as Windows-1252.');
  const { records, unterminatedQuoteLine } = parseCsv(decoded.text, ',');
  if (unterminatedQuoteLine !== null) {
    warnings.add(
      'unterminated_quote',
      `A quoted field starting on line ${unterminatedQuoteLine} is never closed.`,
    );
  }
  const layout = findHeader(records);
  if (layout === null) {
    warnings.add(
      'header_not_found',
      'No Bank of Georgia header row (TariRi, debeti, krediti, ...) was found.',
    );
    return { meta: EMPTY_META, rows: [] };
  }
  const { columns, headerIndex, headerNames } = layout;
  const head = readMeta(records, headerIndex);

  // The opening/closing rows put the currency code in the debit column.
  const at = (cells: readonly string[], k: Column) => {
    const c = columns.get(k);
    return c === undefined ? '' : (cells[c] ?? '');
  };
  let balanceCurrency: string | null = null;
  for (let i = headerIndex + 1; i < records.length && balanceCurrency === null; i++) {
    const cells = records[i]?.cells ?? [];
    if (cells[1]?.trim() === LABEL.opening || cells[1]?.trim() === LABEL.closing) {
      const ccy = at(cells, 'debit').trim();
      if (isCurrencyCode(ccy)) balanceCurrency = ccy;
    }
  }
  const currency = statementCurrency(
    [head.account.currency, balanceCurrency],
    opts.accountCurrency,
    warnings,
  );
  const meta: StatementMeta = {
    accountIban: head.account.iban,
    currency,
    periodFrom: head.period.from,
    periodTo: head.period.to,
    openingBalanceMinor: null,
    closingBalanceMinor: null,
  };

  const missing = (['date', 'debit', 'credit'] as const).filter((k) => !columns.has(k));
  if (missing.length > 0) {
    warnings.add(
      'missing_column',
      `Required column(s) missing: ${missing.map((k) => HEADERS[k]).join(', ')}.`,
    );
    return { meta, rows: [] };
  }

  const amount = (text: string): DecimalParts | null =>
    text.trim() === '' ? null : parseDecimal(text, '.');
  const rows: ParsedRow[] = [];
  let totals: { debit: bigint; credit: bigint } | null = null;

  for (let i = headerIndex + 1; i < records.length; i++) {
    const record = records[i];
    if (record === undefined || isBlankRecord(record.cells)) continue;
    const cells = record.cells;
    const first = cells[0]?.trim() ?? '';
    const second = cells[1]?.trim() ?? '';

    if (second === LABEL.opening || second === LABEL.closing) {
      // `"15.05.2025","sawyisi naSTi",,"GBP",0.04,3.6608,0.14`: balance in the credit column.
      const parts = amount(at(cells, 'credit'));
      const value = parts === null ? null : minorOf(parts, currency, warnings, null);
      if (second === LABEL.opening) meta.openingBalanceMinor = value;
      else meta.closingBalanceMinor = value;
      continue;
    }
    if (first === LABEL.dayTurnover || first === LABEL.dayBalance) continue;
    if (first === LABEL.totalTurnover) {
      const d = amount(at(cells, 'debit'));
      const c = amount(at(cells, 'credit'));
      totals = {
        debit: d === null ? 0n : minorOf(d, currency, warnings, null),
        credit: c === null ? 0n : minorOf(c, currency, warnings, null),
      };
      continue;
    }

    const rowIndex = rows.length;
    const bookedOn = parseDate(first, 'DD.MM.YYYY') ?? parseDate(first, 'DD.MM.YY');
    if (bookedOn === null) {
      warnings.add('unparseable_row', `Line ${record.line} has no valid date and was skipped.`);
      continue;
    }
    const debit = amount(at(cells, 'debit'));
    const credit = amount(at(cells, 'credit'));
    if (
      (debit === null && at(cells, 'debit').trim() !== '') ||
      (credit === null && at(cells, 'credit').trim() !== '')
    ) {
      warnings.add(
        'unparseable_row',
        `Line ${record.line} has an unreadable amount and was skipped.`,
      );
      continue;
    }
    if (debit === null && credit === null) {
      warnings.add('unparseable_row', `Line ${record.line} has no amount and was skipped.`);
      continue;
    }
    if (debit !== null && credit !== null && !isZero(debit) && !isZero(credit)) {
      warnings.add(
        'ambiguous_debit_credit',
        'The row has both a debit and a credit; using credit minus debit.',
        rowIndex,
      );
    }
    const debitMinor = debit === null ? 0n : abs(minorOf(debit, currency, warnings, rowIndex));
    const creditMinor = credit === null ? 0n : abs(minorOf(credit, currency, warnings, rowIndex));
    const amountMinor = creditMinor - debitMinor;

    const gelParts = amount(at(cells, 'gel'));
    const gelAbs = gelParts === null ? null : abs(minorOf(gelParts, 'GEL', warnings, rowIndex));
    const bankGelAmountMinor = gelAbs === null ? null : amountMinor < 0n ? -gelAbs : gelAbs;

    const rawDescription = at(cells, 'description');
    const description = collapseLines(rawDescription);
    const documentNumber = blankToNull(at(cells, 'docN'));
    const counterpartyAccount = blankToNull(at(cells, 'loro'));

    // The CSV has no operation type column: infer it from the document number and the text.
    let operationType: OperationType;
    if (documentNumber?.startsWith('PMI') === true) operationType = 'incoming_payment';
    else if (
      CONVERSION_TEXT.test(description) ||
      isOwnOtherCurrencyAccount(counterpartyAccount, meta)
    ) {
      operationType = 'fx_conversion';
    } else {
      warnings.add(
        'unknown_operation_type',
        'The operation type could not be inferred; the row is marked as other.',
        rowIndex,
      );
      operationType = 'other';
    }
    checkDirection(operationType, amountMinor, warnings, rowIndex);

    let counterparty: string | null = null;
    if (operationType !== 'fx_conversion') {
      const sender = amountMinor >= 0n ? incomingTransferFields(description).Sender : undefined;
      counterparty = sender === undefined ? null : blankToNull(swiftName(sender));
    }

    let counterAmountMinor: bigint | null = null;
    let counterCurrency: string | null = null;
    if (operationType === 'fx_conversion') {
      const counter = counterAmountFromText(description, warnings, rowIndex);
      if (counter !== null) {
        counterAmountMinor = counter.amountMinor;
        counterCurrency = counter.currency;
      }
    }

    const raw: Record<string, string | null> = {};
    headerNames.forEach((name, c) => {
      if (name === '' || name in raw) return;
      const v = cells[c] ?? '';
      raw[name] = v.trim() === '' ? null : v;
    });

    rows.push({
      rowIndex,
      bookedOn,
      amountMinor,
      currency,
      counterparty,
      counterpartyAccount,
      description,
      bankReference: null, // the CSV has no operation ID (FORMAT.md)
      documentNumber,
      operationType,
      bankOperationCode: null, // not printed in the CSV
      bankGelAmountMinor,
      counterAmountMinor,
      counterCurrency,
      raw,
    });
  }

  if (totals !== null) {
    const debit = rows.reduce((s, r) => (r.amountMinor < 0n ? s - r.amountMinor : s), 0n);
    const credit = rows.reduce((s, r) => (r.amountMinor > 0n ? s + r.amountMinor : s), 0n);
    if (debit !== totals.debit || credit !== totals.credit) {
      warnings.add(
        'turnover_mismatch',
        'The total turnover row does not match the sum of the imported rows.',
      );
    }
  }
  finish(meta, rows, warnings);
  return { meta, rows };
}

function abs(n: bigint): bigint {
  return n < 0n ? -n : n;
}

function detectImpl(file: Uint8Array, fileName: string): number {
  if (file.length === 0 || looksBinary(file)) return 0;
  const head = decodeText(file.subarray(0, 16 * 1024)).text;
  // Scores in percent so the result is an exact two-decimal value.
  const nameBonus = /\.csv$/i.test(fileName) ? 5 : 0;
  const header = /"?TariRi"?\s*,\s*"?sabuTis #"?\s*,/.test(head);
  const labels = [META.account, META.period, LABEL.opening, 'angariSis mflobeli:'].filter((l) =>
    head.includes(l),
  ).length;
  if (header && labels >= 2) return (90 + nameBonus) / 100;
  if (header) return (70 + nameBonus) / 100;
  if (labels >= 2) return (30 + nameBonus) / 100;
  return 0;
}

export const bogCsv: StatementParser = {
  id: 'bog-csv',
  detect: safeDetect(detectImpl),
  parse: safeParse('bog-csv', parseImpl),
};
