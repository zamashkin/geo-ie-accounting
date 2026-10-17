// Generic CSV with a user-defined column mapping (contracts `GenericCsvMapping`, saved per account).

import type {
  GenericCsvMapping,
  ParsedRow,
  ParseOptions,
  StatementMeta,
} from '@geo-ie-accounting/contracts';
import type { Delimiter } from '../lib/csv';
import { isBlankRecord, parseCsv, sniffDelimiter } from '../lib/csv';
import { isCurrencyCode, iso4217Exponent } from '@geo-ie-accounting/domain';
import { parseDate } from '../lib/dates';
import type { DecimalParts } from '../lib/decimal';
import { isZero, parseAmountText, toMinor } from '../lib/decimal';
import { blankToNull, collapseLines, decodeText, looksBinary } from '../lib/text';
import type { StatementParser } from '../parser';
import { EMPTY_META, safeDetect, safeParse } from '../parser';
import type { Warnings } from '../warnings';

/** Locates a mapped column: exact trimmed header first, then case- and space-insensitive. */
function columnOf(headers: readonly string[], name: string): number | null {
  const wanted = name.trim();
  const exact = headers.findIndex((h) => h.trim() === wanted);
  if (exact !== -1) return exact;
  const loose = wanted.replace(/\s+/g, ' ').toLowerCase();
  const i = headers.findIndex((h) => h.trim().replace(/\s+/g, ' ').toLowerCase() === loose);
  return i === -1 ? null : i;
}

type Amount =
  { kind: 'signed'; column: number } | { kind: 'debit_credit'; debit: number; credit: number };

interface Columns {
  date: number;
  amount: Amount;
  currency: number | null;
  counterparty: number | null;
  description: number | null;
  reference: number | null;
}

function resolveColumns(
  headers: readonly string[],
  mapping: GenericCsvMapping,
  warnings: Warnings,
): Columns | null {
  const missing: string[] = [];
  const need = (name: string): number => {
    const c = columnOf(headers, name);
    if (c === null) missing.push(name);
    return c ?? -1;
  };
  const optional = (name: string | undefined, label: string): number | null => {
    if (name === undefined) return null;
    const c = columnOf(headers, name);
    if (c === null)
      warnings.add('missing_column', `The mapped ${label} column was not found; it is ignored.`);
    return c;
  };
  const date = need(mapping.date);
  const amount: Amount =
    mapping.amount.kind === 'signed'
      ? { kind: 'signed', column: need(mapping.amount.column) }
      : {
          kind: 'debit_credit',
          debit: need(mapping.amount.debit),
          credit: need(mapping.amount.credit),
        };
  if (missing.length > 0) {
    // Column names come from the user's mapping, not from statement contents.
    warnings.add(
      'missing_column',
      `Mapped column(s) not found in the header row: ${missing.join(', ')}.`,
    );
    return null;
  }
  return {
    date,
    amount,
    currency: optional(mapping.currency, 'currency'),
    counterparty: optional(mapping.counterparty, 'counterparty'),
    description: optional(mapping.description, 'description'),
    reference: optional(mapping.reference, 'reference'),
  };
}

function parseImpl(
  file: Uint8Array,
  opts: ParseOptions,
  warnings: Warnings,
): { meta: StatementMeta; rows: ParsedRow[] } {
  const mapping = opts.mapping;
  if (mapping === undefined) {
    warnings.add('mapping_required', 'The generic CSV parser needs a column mapping.');
    return { meta: EMPTY_META, rows: [] };
  }
  if (looksBinary(file)) {
    warnings.add('unreadable_file', 'The file is not a text CSV.');
    return { meta: EMPTY_META, rows: [] };
  }
  const decoded = decodeText(file);
  if (decoded.fallback)
    warnings.add('encoding_fallback', 'The file is not UTF-8; it was read as Windows-1252.');
  const delimiter: Delimiter = mapping.delimiter ?? sniffDelimiter(decoded.text);
  const { records, unterminatedQuoteLine } = parseCsv(decoded.text, delimiter);
  if (unterminatedQuoteLine !== null) {
    warnings.add(
      'unterminated_quote',
      `A quoted field starting on line ${unterminatedQuoteLine} is never closed.`,
    );
  }

  const header = records[mapping.headerRow];
  if (header === undefined) {
    warnings.add(
      'header_not_found',
      `The file has no record ${mapping.headerRow + 1} to use as the header row.`,
    );
    return { meta: EMPTY_META, rows: [] };
  }
  const headers = header.cells;
  const cols = resolveColumns(headers, mapping, warnings);
  if (cols === null) return { meta: EMPTY_META, rows: [] };

  const cell = (cells: readonly string[], c: number | null) => (c === null ? '' : (cells[c] ?? ''));
  const parseAmount = (text: string): DecimalParts | null | 'invalid' =>
    text.trim() === '' ? null : (parseAmountText(text, mapping.decimalSeparator) ?? 'invalid');

  /** Signed amount in minor units, or null (with a warning) when the row has no usable amount. */
  const readAmount = (
    cells: readonly string[],
    line: number,
    rowIndex: number,
    currency: string,
  ): bigint | null => {
    const exp = iso4217Exponent(currency);
    const minor = (p: DecimalParts) => {
      const r = toMinor(p, exp);
      if (r.rounded && !r.floatNoise) {
        warnings.add(
          'amount_rounded',
          'An amount had more decimals than its currency allows and was rounded.',
          rowIndex,
        );
      }
      return r.minor;
    };
    if (cols.amount.kind === 'signed') {
      const a = parseAmount(cell(cells, cols.amount.column));
      if (a === 'invalid' || a === null) {
        warnings.add(
          'unparseable_row',
          `Line ${line} has ${a === null ? 'no' : 'an unreadable'} amount and was skipped.`,
        );
        return null;
      }
      return minor(a);
    }
    const d = parseAmount(cell(cells, cols.amount.debit));
    const c = parseAmount(cell(cells, cols.amount.credit));
    if (d === 'invalid' || c === 'invalid' || (d === null && c === null)) {
      warnings.add('unparseable_row', `Line ${line} has no readable amount and was skipped.`);
      return null;
    }
    if (d !== null && c !== null && !isZero(d) && !isZero(c)) {
      warnings.add(
        'ambiguous_debit_credit',
        'The row has both a debit and a credit; using credit minus debit.',
        rowIndex,
      );
    }
    // Debit/credit columns are magnitudes; some banks print debits negative, so ignore their sign.
    const credit = c === null ? 0n : minor({ ...c, negative: false });
    const debit = d === null ? 0n : minor({ ...d, negative: false });
    return credit - debit;
  };

  const rows: ParsedRow[] = [];
  for (let i = mapping.headerRow + 1; i < records.length; i++) {
    const record = records[i];
    if (record === undefined || isBlankRecord(record.cells)) continue;
    const cells = record.cells;
    const rowIndex = rows.length;

    const bookedOn = parseDate(cell(cells, cols.date), mapping.dateFormat);
    if (bookedOn === null) {
      // Trailing summary rows ("Total", "Closing balance") land here too.
      warnings.add('unparseable_row', `Line ${record.line} has no valid date and was skipped.`);
      continue;
    }

    let currency = opts.accountCurrency;
    if (cols.currency !== null) {
      const ccy = cell(cells, cols.currency).trim().toUpperCase();
      if (isCurrencyCode(ccy)) currency = ccy;
      else
        warnings.add(
          'invalid_currency',
          'The row has no valid currency code; using the account currency.',
          rowIndex,
        );
    }

    const amountMinor = readAmount(cells, record.line, rowIndex, currency);
    if (amountMinor === null) continue;

    const raw: Record<string, string | null> = {};
    headers.forEach((h, c) => {
      let name = h.trim();
      if (name === '') name = `column_${c + 1}`;
      if (name in raw) name = `${name} (${c + 1})`;
      const v = cells[c] ?? '';
      raw[name] = v.trim() === '' ? null : v;
    });

    rows.push({
      rowIndex,
      bookedOn,
      amountMinor,
      currency,
      counterparty: blankToNull(collapseLines(cell(cells, cols.counterparty))),
      counterpartyAccount: null,
      description: collapseLines(cell(cells, cols.description)),
      bankReference: blankToNull(cell(cells, cols.reference)),
      documentNumber: null,
      // A generic CSV says nothing reliable about what an operation is; the pipeline's rules decide.
      operationType: 'other',
      bankOperationCode: null,
      bankGelAmountMinor: null,
      counterAmountMinor: null,
      counterCurrency: null,
      raw,
    });
  }

  if (rows.length === 0) warnings.add('no_rows', 'The file contains no transactions.');
  return { meta: EMPTY_META, rows };
}

function detectImpl(file: Uint8Array, fileName: string): number {
  if (file.length === 0 || looksBinary(file)) return 0;
  const text = decodeText(file.subarray(0, 16 * 1024)).text;
  const { records } = parseCsv(text, sniffDelimiter(text));
  const wide = records.filter((r) => r.cells.length >= 2).length;
  if (wide < 2) return 0;
  // Any table is mappable, so this is the fallback: it never outranks a bank-specific parser.
  return /\.(csv|txt|tsv)$/i.test(fileName) ? 0.3 : 0.2;
}

export const genericCsv: StatementParser = {
  id: 'generic-csv',
  detect: safeDetect(detectImpl),
  parse: safeParse('generic-csv', parseImpl),
};
