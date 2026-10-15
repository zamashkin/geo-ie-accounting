// A small, forgiving CSV tokenizer (RFC 4180 plus what real bank exports do).
//
// - Quoted fields may contain delimiters, `""` and line breaks (BoG puts "\r\n\t  " inside them).
// - Line endings may be CRLF, LF or CR, mixed within one file.
// - Backslash is an ordinary character. BoG uses it for SWIFT line wraps, never as an escape.
// - Malformed quoting never throws: a stray quote inside an unquoted field is kept literally, text
//   after a closing quote is appended, and an unterminated quote runs to the end of the file.

export type Delimiter = ',' | ';' | '\t';

export interface CsvRecord {
  /** 1-based line number where the record starts. */
  line: number;
  cells: string[];
}

export interface CsvParseResult {
  records: CsvRecord[];
  /** Line where an unterminated quoted field started, if any. */
  unterminatedQuoteLine: number | null;
}

const QUOTE = 34; // "
const CR = 13;
const LF = 10;

export function parseCsv(text: string, delimiter: Delimiter): CsvParseResult {
  const delim = delimiter.charCodeAt(0);
  const records: CsvRecord[] = [];
  const n = text.length;
  let line = 1;
  let unterminatedQuoteLine: number | null = null;
  let i = 0;

  let cells: string[] = [];
  let recordLine = 1;
  let field = '';
  let atFieldStart = true;

  const endField = () => {
    cells.push(field);
    field = '';
    atFieldStart = true;
  };
  const endRecord = () => {
    endField();
    records.push({ line: recordLine, cells });
    cells = [];
  };

  while (i < n) {
    const c = text.charCodeAt(i);
    if (atFieldStart && c === QUOTE) {
      // Quoted field: read up to the closing quote.
      const startLine = line;
      i++;
      let closed = false;
      while (i < n) {
        const q = text.indexOf('"', i);
        const chunkEnd = q === -1 ? n : q;
        const chunk = text.slice(i, chunkEnd);
        line += countLineBreaks(chunk);
        field += chunk;
        if (q === -1) {
          i = n;
          break;
        }
        if (text.charCodeAt(q + 1) === QUOTE) {
          field += '"';
          i = q + 2;
          continue;
        }
        i = q + 1;
        closed = true;
        break;
      }
      if (!closed) unterminatedQuoteLine ??= startLine;
      atFieldStart = false;
      continue;
    }
    atFieldStart = false;
    if (c === delim) {
      endField();
      i++;
    } else if (c === CR || c === LF) {
      endRecord();
      i += c === CR && text.charCodeAt(i + 1) === LF ? 2 : 1;
      line++;
      recordLine = line;
    } else {
      // Plain run up to the next delimiter, quote or line break.
      let j = i + 1;
      while (j < n) {
        const d = text.charCodeAt(j);
        if (d === delim || d === CR || d === LF) break;
        j++;
      }
      field += text.slice(i, j);
      i = j;
    }
  }
  // Last record without a trailing newline. A file ending in a newline does not add an empty one.
  if (!atFieldStart || field !== '' || cells.length > 0) endRecord();

  return { records, unterminatedQuoteLine };
}

function countLineBreaks(s: string): number {
  let count = 0;
  for (let k = 0; k < s.length; k++) {
    const c = s.charCodeAt(k);
    if (c === LF) count++;
    else if (c === CR && s.charCodeAt(k + 1) !== LF) count++;
  }
  return count;
}

/**
 * Guesses the delimiter from the first non-empty records: the candidate that gives the most
 * consistent multi-column split wins. Falls back to `,`.
 */
export function sniffDelimiter(text: string): Delimiter {
  const sample = text.slice(0, 64 * 1024);
  let best: Delimiter = ',';
  let bestScore = 0;
  for (const d of [',', ';', '\t'] as const) {
    const { records } = parseCsv(sample, d);
    const widths = records
      .filter((r) => r.cells.some((c) => c.trim() !== ''))
      .slice(0, 20)
      .map((r) => r.cells.length);
    if (widths.length === 0) continue;
    const counts = new Map<number, number>();
    for (const w of widths) counts.set(w, (counts.get(w) ?? 0) + 1);
    let modeWidth = 1;
    let modeCount = 0;
    for (const [w, count] of counts) {
      if (count > modeCount || (count === modeCount && w > modeWidth)) {
        modeWidth = w;
        modeCount = count;
      }
    }
    if (modeWidth < 2) continue;
    const score = modeCount * Math.log2(modeWidth);
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

/** True if every cell of the record is blank. */
export function isBlankRecord(cells: readonly string[]): boolean {
  return cells.every((c) => c.trim() === '');
}
