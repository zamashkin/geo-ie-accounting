// Minimal XLSX (SpreadsheetML) reader: enough to read statement exports, nothing more.
//
// Why hand-rolled (ADR 0008): the general libraries hand numeric cells back as JS numbers, and
// money must never pass through a float. Here every cell keeps the exact text of its `<v>` or
// string element. Unzipping is fflate (pure JS, no native code, no dependencies).
//
// Supported: shared strings (incl. rich-text runs), inline strings, `str`/`n`/`b`/`e`/`d` cells,
// namespace prefixes (BoG writes `<x:row>`), sparse rows and cells, missing `r` attributes,
// `_xHHHH_` escapes, the 1904 date system flag. Not supported (not needed): formulas are read as
// their cached value, styles/number formats are ignored, only the cells are read.

import { unzipSync } from 'fflate';

export type CellType = 'string' | 'number' | 'boolean' | 'error' | 'date';

export interface Cell {
  type: CellType;
  /** Exact text: the string value, or the `<v>` text of a number (`-690.85`, `45812`). */
  text: string;
}

export interface Sheet {
  name: string;
  /** Dense array of rows by 0-based row index; a row is a sparse array of cells by column. */
  rows: (Cell | undefined)[][];
}

export interface Workbook {
  sheets: Sheet[];
  date1904: boolean;
}

export class XlsxError extends Error {
  override readonly name = 'XlsxError';
}

/** Hard limits so a hostile file cannot exhaust memory. */
const MAX_ENTRY_BYTES = 64 * 1024 * 1024;
const MAX_ROWS = 1_048_576;
const MAX_COLUMNS = 16_384;

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];

export function isZip(bytes: Uint8Array): boolean {
  return ZIP_MAGIC.every((b, i) => bytes[i] === b);
}

/** Reads all worksheets. Throws XlsxError for anything that is not a readable workbook. */
export function readWorkbook(bytes: Uint8Array): Workbook {
  if (!isZip(bytes)) throw new XlsxError('not a zip archive');
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      filter: (f) =>
        f.originalSize <= MAX_ENTRY_BYTES &&
        (f.name.endsWith('.xml') || f.name.endsWith('.rels')) &&
        (f.name.startsWith('xl/') || f.name.startsWith('/xl/')),
    });
  } catch (e) {
    throw new XlsxError(`cannot unzip: ${e instanceof Error ? e.message : 'unknown error'}`);
  }
  const entries = new Map<string, Uint8Array>();
  for (const [name, data] of Object.entries(files)) entries.set(name.replace(/^\//, ''), data);

  const utf8 = new TextDecoder('utf-8');
  const read = (path: string): string | null => {
    const data = entries.get(path);
    return data === undefined ? null : utf8.decode(data);
  };

  const workbookXml = read('xl/workbook.xml');
  if (workbookXml === null) throw new XlsxError('xl/workbook.xml missing');
  const date1904 = /<(?:\w+:)?workbookPr\b[^>]*\bdate1904="(?:1|true)"/.test(workbookXml);

  const relsXml = read('xl/_rels/workbook.xml.rels') ?? '';
  const rels = new Map<string, string>();
  for (const m of relsXml.matchAll(/<(?:\w+:)?Relationship\b([^>]*)\/?>/g)) {
    const id = attr(m[1] ?? '', 'Id');
    const target = attr(m[1] ?? '', 'Target');
    if (id !== null && target !== null) rels.set(id, resolveTarget(target));
  }

  const sharedXml = read(findRelTarget(relsXml, 'sharedStrings') ?? 'xl/sharedStrings.xml');
  const shared = sharedXml === null ? [] : readSharedStrings(sharedXml);

  const sheets: Sheet[] = [];
  for (const m of workbookXml.matchAll(/<(?:\w+:)?sheet\b([^>]*)\/?>/g)) {
    const attrs = m[1] ?? '';
    const name = decodeXml(attr(attrs, 'name') ?? '');
    const rid = attrNs(attrs, 'id');
    const path =
      (rid !== null ? rels.get(rid) : undefined) ?? `xl/worksheets/sheet${sheets.length + 1}.xml`;
    const xml = read(path);
    if (xml === null) continue;
    sheets.push({ name, rows: readSheet(xml, shared) });
  }
  if (sheets.length === 0) throw new XlsxError('no worksheets');
  return { sheets, date1904 };
}

function findRelTarget(relsXml: string, typeSuffix: string): string | null {
  for (const m of relsXml.matchAll(/<(?:\w+:)?Relationship\b([^>]*)\/?>/g)) {
    const type = attr(m[1] ?? '', 'Type') ?? '';
    const target = attr(m[1] ?? '', 'Target');
    if (type.endsWith(`/${typeSuffix}`) && target !== null) return resolveTarget(target);
  }
  return null;
}

/** Relationship targets are relative to `xl/` unless absolute. */
function resolveTarget(target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = ['xl'];
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.' && seg !== '') parts.push(seg);
  }
  return parts.join('/');
}

const attrPatterns = new Map<string, RegExp>();

function attr(attrs: string, name: string): string | null {
  let re = attrPatterns.get(name);
  if (re === undefined) {
    re = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`);
    attrPatterns.set(name, re);
  }
  const m = re.exec(attrs);
  return m ? (m[1] ?? m[2] ?? null) : null;
}

/** Attribute with any namespace prefix, e.g. `r:id`. */
function attrNs(attrs: string, local: string): string | null {
  const m = new RegExp(`\\s\\w+:${local}="([^"]*)"`).exec(attrs);
  return m ? (m[1] ?? null) : null;
}

const ENTITY = /&(?:#x([0-9a-fA-F]+)|#(\d+)|(amp|lt|gt|quot|apos));/g;
const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decodeXml(s: string): string {
  if (!s.includes('&')) return s;
  return s.replace(
    ENTITY,
    (whole, hex: string | undefined, dec: string | undefined, named: string | undefined) => {
      if (named !== undefined) return NAMED[named] ?? whole;
      const code = hex !== undefined ? Number.parseInt(hex, 16) : Number.parseInt(dec ?? '', 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    },
  );
}

/** OOXML escapes characters XML cannot carry as `_xHHHH_` (e.g. `_x000D_` for CR). */
function decodeOoxmlEscapes(s: string): string {
  if (!s.includes('_x')) return s;
  return s.replace(/_x([0-9A-Fa-f]{4})_/g, (_, hex: string) =>
    String.fromCharCode(Number.parseInt(hex, 16)),
  );
}

/** Concatenated text of all `<t>` elements, skipping phonetic runs (`<rPh>`). */
function textOf(xml: string): string {
  const withoutPhonetic = xml.includes('rPh')
    ? xml.replace(/<(?:\w+:)?rPh\b[\s\S]*?<\/(?:\w+:)?rPh>/g, '')
    : xml;
  let out = '';
  for (const m of withoutPhonetic.matchAll(
    /<(?:\w+:)?t\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:\w+:)?t>)/g,
  )) {
    out += m[1] ?? '';
  }
  return decodeOoxmlEscapes(decodeXml(out));
}

function readSharedStrings(xml: string): string[] {
  const out: string[] = [];
  for (const m of xml.matchAll(/<(?:\w+:)?si\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:\w+:)?si>)/g)) {
    out.push(textOf(m[1] ?? ''));
  }
  return out;
}

const ROW_RE = /<(?:\w+:)?row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?row>)/g;
const CELL_RE = /<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g;
const V_RE = /<(?:\w+:)?v\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:\w+:)?v>)/;
const IS_RE = /<(?:\w+:)?is\b[^>]*?>([\s\S]*?)<\/(?:\w+:)?is>/;

function readSheet(xml: string, shared: readonly string[]): (Cell | undefined)[][] {
  const rows: (Cell | undefined)[][] = [];
  let nextRow = 0;
  for (const rm of xml.matchAll(ROW_RE)) {
    const rAttr = attr(rm[1] ?? '', 'r');
    const rowIndex =
      rAttr !== null && /^\d+$/.test(rAttr) ? Number.parseInt(rAttr, 10) - 1 : nextRow;
    if (rowIndex < 0 || rowIndex >= MAX_ROWS) continue;
    nextRow = rowIndex + 1;
    const cells: (Cell | undefined)[] = [];
    let nextCol = 0;
    for (const cm of (rm[2] ?? '').matchAll(CELL_RE)) {
      const attrs = cm[1] ?? '';
      const ref = attr(attrs, 'r');
      const col = ref !== null ? columnIndex(ref) : nextCol;
      if (col < 0 || col >= MAX_COLUMNS) continue;
      nextCol = col + 1;
      const cell = readCell(attr(attrs, 't') ?? 'n', cm[2] ?? '', shared);
      if (cell !== undefined) cells[col] = cell;
    }
    rows[rowIndex] = cells;
  }
  // Fill holes so callers can iterate densely.
  for (let i = 0; i < rows.length; i++) rows[i] ??= [];
  return rows;
}

function readCell(type: string, inner: string, shared: readonly string[]): Cell | undefined {
  if (type === 'inlineStr') {
    const is = IS_RE.exec(inner);
    return { type: 'string', text: is ? textOf(is[1] ?? '') : '' };
  }
  const v = V_RE.exec(inner);
  if (!v) return undefined;
  const raw = decodeXml(v[1] ?? '');
  switch (type) {
    case 's': {
      const idx = Number.parseInt(raw, 10);
      return { type: 'string', text: shared[idx] ?? '' };
    }
    case 'str':
      return { type: 'string', text: decodeOoxmlEscapes(raw) };
    case 'b':
      return { type: 'boolean', text: raw.trim() === '1' ? 'TRUE' : 'FALSE' };
    case 'e':
      return { type: 'error', text: raw };
    case 'd':
      return { type: 'date', text: raw.trim() };
    default:
      return { type: 'number', text: raw.trim() };
  }
}

/** "AK20" -> 36. Returns -1 for a malformed reference. */
export function columnIndex(ref: string): number {
  const m = /^([A-Za-z]{1,3})\d*$/.exec(ref.replace(/\$/g, ''));
  if (!m) return -1;
  let n = 0;
  for (const ch of (m[1] ?? '').toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}
