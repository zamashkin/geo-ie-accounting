// Bank of Georgia XLSX statement (`Statement of Account` sheet). See bog/FORMAT.md.

import type { ParsedRow, ParseOptions, StatementMeta } from '@ie-ledger/contracts';
import { currencyExponent, isCurrencyCode } from '../lib/currency';
import { excelSerialToIso, parseDate } from '../lib/dates';
import type { DecimalParts } from '../lib/decimal';
import { isZero, parseDecimal, parsePlainNumber, toMinor } from '../lib/decimal';
import { blankToNull, collapseLines, normaliseLabel, swiftName } from '../lib/text';
import type { Cell, Sheet, Workbook } from '../lib/xlsx';
import { isZip, readWorkbook, XlsxError } from '../lib/xlsx';
import type { StatementParser } from '../parser';
import { EMPTY_META, safeDetect, safeParse } from '../parser';
import type { Warnings } from '../warnings';
import {
  checkDirection,
  counterAmountFromText,
  finish,
  minorOf,
  operationTypeOf,
  parseAccountField,
  parsePeriod,
  statementCurrency,
} from './common';

/** Column keys -> normalised header text (trimmed, single spaces, lower case). */
const COLUMNS = {
  date: 'date',
  docN: 'doc n',
  loro: 'loro account',
  debit: 'debit',
  credit: 'credit',
  debitGel: 'debit amount in gel',
  creditGel: 'credit amount in gel',
  comment: 'entry comment',
  opType: 'operation type',
  opId: 'operation id',
  ref: 'ref',
  senderName: 'sender name',
  senderAccount: 'sender account n',
  recipientName: 'recipient name',
  recipientAccount: 'recipient account n',
  nomination: 'nomination',
  amount: 'amount',
  amountGel: 'amount in gel',
  destAmount: 'destination amount',
  destCcy: 'destination ccy',
  balance: 'balance',
} as const;
type Column = keyof typeof COLUMNS;

/** Header markers that only a BoG statement has, for detection. */
const MARKERS = [
  'loro account',
  'operation id',
  'entry comment',
  'balance at end of day',
  'destination ccy',
];

const HEADER_SEARCH_ROWS = 100;

interface Located {
  sheet: Sheet;
  headerRow: number;
  columns: Map<Column, number>;
  /** Trimmed header text per column index, for `raw`. */
  headers: Map<number, string>;
}

function cellText(cell: Cell | undefined): string {
  return cell === undefined ? '' : cell.text;
}

function locate(workbook: Workbook): Located | null {
  const preferred = workbook.sheets.find((s) => normaliseLabel(s.name) === 'statement of account');
  const order = preferred
    ? [preferred, ...workbook.sheets.filter((s) => s !== preferred)]
    : workbook.sheets;
  for (const sheet of order) {
    const limit = Math.min(sheet.rows.length, HEADER_SEARCH_ROWS);
    for (let r = 0; r < limit; r++) {
      const row = sheet.rows[r] ?? [];
      const byLabel = new Map<string, number>();
      row.forEach((cell, c) => {
        if (cell?.type !== 'string') return;
        const label = normaliseLabel(cell.text);
        if (label !== '' && !byLabel.has(label)) byLabel.set(label, c);
      });
      if (!byLabel.has('date') || !(byLabel.has('debit') || byLabel.has('amount'))) continue;
      const columns = new Map<Column, number>();
      for (const [key, label] of Object.entries(COLUMNS) as [Column, string][]) {
        const c = byLabel.get(label);
        if (c !== undefined) columns.set(key, c);
      }
      const headers = new Map<number, string>();
      const seen = new Set<string>();
      row.forEach((cell, c) => {
        const name = cell === undefined ? '' : cell.text.trim();
        if (name === '' || seen.has(name)) return;
        seen.add(name);
        headers.set(c, name);
      });
      return { sheet, headerRow: r, columns, headers };
    }
  }
  return null;
}

/** Number from a cell: the exact `<v>` text for numbers, human formatting for strings. */
function cellNumber(cell: Cell | undefined): DecimalParts | null {
  if (cell === undefined) return null;
  if (cell.type === 'number') return parsePlainNumber(cell.text);
  if (cell.type === 'string') return cell.text.trim() === '' ? null : parseDecimal(cell.text, '.');
  return null;
}

/** IDs stored as numbers come back as `90000000001` or `9.0000000001E10`; print them plainly. */
function cellId(cell: Cell | undefined): string | null {
  if (cell === undefined) return null;
  if (cell.type === 'number') {
    const parts = parsePlainNumber(cell.text, Number.POSITIVE_INFINITY);
    if (parts !== null && !/[1-9]/.test(parts.fracDigits)) {
      return (parts.negative ? '-' : '') + parts.intDigits.replace(/^0+(?=\d)/, '');
    }
  }
  return blankToNull(cell.text);
}

function cellDate(cell: Cell | undefined, date1904: boolean): string | null {
  if (cell === undefined) return null;
  switch (cell.type) {
    case 'number':
      return excelSerialToIso(cell.text, date1904);
    case 'date':
      return parseDate(cell.text.slice(0, 10), 'YYYY-MM-DD');
    case 'string':
      return parseDate(cell.text, 'DD.MM.YYYY') ?? parseDate(cell.text, 'YYYY-MM-DD');
    default:
      return null;
  }
}

function readMeta(located: Located, opts: ParseOptions, warnings: Warnings) {
  const values = new Map<string, Cell>();
  for (let r = 0; r < located.headerRow; r++) {
    const row = located.sheet.rows[r] ?? [];
    for (let c = 0; c < row.length; c++) {
      const cell = row[c];
      if (cell?.type !== 'string') continue;
      const label = normaliseLabel(cell.text);
      if (label === '' || values.has(label)) continue;
      // The value is the next non-empty cell to the right.
      for (let v = c + 1; v < row.length; v++) {
        const value = row[v];
        if (value !== undefined && value.text.trim() !== '') {
          values.set(label, value);
          break;
        }
      }
    }
  }
  const text = (...labels: string[]) => {
    for (const l of labels) {
      const v = values.get(l);
      if (v !== undefined) return v.text.trim();
    }
    return null;
  };
  const account = parseAccountField(text('account n', 'account no', 'account') ?? '');
  const period = parsePeriod(text('period') ?? '');
  const currency = statementCurrency(
    [text('currency'), account.currency],
    opts.accountCurrency,
    warnings,
  );
  const balance = (...labels: string[]) => {
    for (const l of labels) {
      const parts = cellNumber(values.get(l));
      if (parts !== null) return minorOf(parts, currency, warnings, null);
    }
    return null;
  };
  const meta: StatementMeta = {
    accountIban: account.iban,
    currency,
    periodFrom: period.from,
    periodTo: period.to,
    openingBalanceMinor: balance('begining balance', 'beginning balance', 'opening balance'),
    closingBalanceMinor: balance('ending balance', 'closing balance'),
  };
  return meta;
}

function parseImpl(
  file: Uint8Array,
  opts: ParseOptions,
  warnings: Warnings,
): { meta: StatementMeta; rows: ParsedRow[] } {
  let workbook: Workbook;
  try {
    workbook = readWorkbook(file);
  } catch (e) {
    if (!(e instanceof XlsxError)) throw e;
    warnings.add('unreadable_file', 'The file is not a readable XLSX workbook.');
    return { meta: EMPTY_META, rows: [] };
  }
  const located = locate(workbook);
  if (located === null) {
    warnings.add(
      'header_not_found',
      'No statement header row (Date, Debit, Credit, ...) was found.',
    );
    return { meta: EMPTY_META, rows: [] };
  }
  const meta = readMeta(located, opts, warnings);
  const currency = meta.currency ?? opts.accountCurrency;
  const col = located.columns;

  const required: Column[] = ['date'];
  if (!col.has('amount')) required.push('debit', 'credit');
  const missing = required.filter((k) => !col.has(k));
  if (missing.length > 0) {
    warnings.add(
      'missing_column',
      `Required column(s) missing: ${missing.map((k) => COLUMNS[k]).join(', ')}.`,
    );
    return { meta, rows: [] };
  }

  const rows: ParsedRow[] = [];
  let running = meta.openingBalanceMinor;
  let runningChecked = true;

  for (let r = located.headerRow + 1; r < located.sheet.rows.length; r++) {
    const cells = located.sheet.rows[r] ?? [];
    if (cells.every((c) => c === undefined || c.text.trim() === '')) continue;
    const get = (k: Column) => {
      const c = col.get(k);
      return c === undefined ? undefined : cells[c];
    };
    const text = (k: Column) => blankToNull(cellText(get(k)));
    const sheetRow = r + 1;
    const rowIndex = rows.length;

    const bookedOn = cellDate(get('date'), workbook.date1904);
    if (bookedOn === null) {
      warnings.add('unparseable_row', `Sheet row ${sheetRow} has no valid date and was skipped.`);
      continue;
    }

    // Amount: the signed `Amount` column, cross-checked against Debit / Credit.
    const debit = cellNumber(get('debit'));
    const credit = cellNumber(get('credit'));
    const signed = cellNumber(get('amount'));
    const hasDebit = debit !== null && !isZero(debit);
    const hasCredit = credit !== null && !isZero(credit);
    const fromPair =
      debit === null && credit === null
        ? null
        : (credit === null ? 0n : abs(minorOf(credit, currency, warnings, rowIndex))) -
          (debit === null ? 0n : abs(minorOf(debit, currency, warnings, rowIndex)));
    let amountMinor: bigint;
    if (signed !== null) {
      amountMinor = minorOf(signed, currency, warnings, rowIndex);
      if (fromPair !== null && fromPair !== amountMinor) {
        warnings.add(
          'amount_mismatch',
          'The signed Amount disagrees with Debit/Credit; Amount was used.',
          rowIndex,
        );
      }
    } else if (fromPair !== null) {
      if (hasDebit && hasCredit) {
        warnings.add(
          'ambiguous_debit_credit',
          'The row has both a debit and a credit; using credit minus debit.',
          rowIndex,
        );
      }
      amountMinor = fromPair;
    } else {
      warnings.add('unparseable_row', `Sheet row ${sheetRow} has no amount and was skipped.`);
      continue;
    }

    // Bank's GEL equivalent, signed like the amount.
    const gelSigned = cellNumber(get('amountGel'));
    const gelDebit = cellNumber(get('debitGel'));
    const gelCredit = cellNumber(get('creditGel'));
    let bankGelAmountMinor: bigint | null = null;
    if (gelSigned !== null) bankGelAmountMinor = minorOf(gelSigned, 'GEL', warnings, rowIndex);
    else if (gelDebit !== null || gelCredit !== null) {
      bankGelAmountMinor =
        (gelCredit === null ? 0n : abs(minorOf(gelCredit, 'GEL', warnings, rowIndex))) -
        (gelDebit === null ? 0n : abs(minorOf(gelDebit, 'GEL', warnings, rowIndex)));
    }

    const code = text('opType')?.toUpperCase() ?? null;
    let operationType = code === null ? null : operationTypeOf(code);
    if (operationType === null) {
      warnings.add(
        'unknown_operation_type',
        'Unknown or missing bank operation code; the row is marked as other.',
        rowIndex,
      );
      operationType = 'other';
    }
    checkDirection(operationType, amountMinor, warnings, rowIndex);

    const description = collapseLines(text('comment') ?? text('nomination') ?? '');

    let counterparty: string | null = null;
    if (operationType !== 'fx_conversion') {
      const party = amountMinor >= 0n ? text('senderName') : text('recipientName');
      counterparty = party === null ? null : blankToNull(swiftName(party));
    }
    const counterpartyAccount =
      text('loro') ?? (amountMinor >= 0n ? text('senderAccount') : text('recipientAccount'));

    let counterAmountMinor: bigint | null = null;
    let counterCurrency: string | null = null;
    if (operationType === 'fx_conversion') {
      const destCcy = text('destCcy')?.toUpperCase() ?? null;
      const destAmount = cellNumber(get('destAmount'));
      if (destCcy !== null && isCurrencyCode(destCcy) && destAmount !== null) {
        counterCurrency = destCcy;
        counterAmountMinor = abs(minorOf(destAmount, destCcy, warnings, rowIndex));
      } else {
        const fromText = counterAmountFromText(description, warnings, rowIndex);
        if (fromText !== null) {
          counterCurrency = fromText.currency;
          counterAmountMinor = fromText.amountMinor;
        }
      }
    }

    // Running balance check: report only the first row where it breaks.
    if (running !== null) running += amountMinor;
    const balance = cellNumber(get('balance'));
    if (runningChecked && running !== null && balance !== null) {
      const { minor } = toMinor(balance, currencyExponent(currency));
      if (minor !== running) {
        warnings.add(
          'running_balance_mismatch',
          'The running balance stops matching the amounts at this row.',
          rowIndex,
        );
        runningChecked = false;
      }
    }

    const raw: Record<string, string | null> = {};
    for (const [c, name] of located.headers)
      raw[name] = blankToNull(cellText(cells[c])) === null ? null : cellText(cells[c]);

    rows.push({
      rowIndex,
      bookedOn,
      amountMinor,
      currency,
      counterparty,
      counterpartyAccount,
      description,
      bankReference: cellId(get('opId')) ?? cellId(get('ref')),
      documentNumber: text('docN'),
      operationType,
      bankOperationCode: code,
      bankGelAmountMinor,
      counterAmountMinor,
      counterCurrency,
      raw,
    });
  }

  finish(meta, rows, warnings);
  return { meta, rows };
}

function abs(n: bigint): bigint {
  return n < 0n ? -n : n;
}

function detectImpl(file: Uint8Array, fileName: string): number {
  if (!isZip(file)) return 0;
  // Scores in percent so the result is an exact two-decimal value.
  const nameBonus = /\.xlsx$/i.test(fileName) ? 5 : 0;
  let workbook: Workbook;
  try {
    workbook = readWorkbook(file);
  } catch {
    return 0;
  }
  const located = locate(workbook);
  if (located === null) return (5 + nameBonus) / 100;
  const row = located.sheet.rows[located.headerRow] ?? [];
  const labels = new Set(row.map((c) => (c === undefined ? '' : normaliseLabel(c.text))));
  const hits = MARKERS.filter((m) => labels.has(m)).length;
  if (hits >= 3) return (90 + nameBonus) / 100;
  if (hits >= 1) return (50 + nameBonus) / 100;
  return (10 + nameBonus) / 100;
}

export const bogXlsx: StatementParser = {
  id: 'bog-xlsx',
  detect: safeDetect(detectImpl),
  parse: safeParse('bog-xlsx', parseImpl),
};
