// Test helper: builds small XLSX files in memory, so tests never commit generated binaries.

import { strToU8, zipSync } from 'fflate';

/** A cell: string -> inline string (or shared, see options), `{ n }` -> number with exact text. */
export type TestCell = string | { n: string } | { s: string } | { b: boolean } | null;

export interface BuildOptions {
  sheetName?: string;
  /** Namespace prefix for SpreadsheetML elements (BoG writes `x:`). */
  prefix?: string;
  /** Write strings to sharedStrings.xml instead of inline. */
  sharedStrings?: boolean;
  date1904?: boolean;
}

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function colName(i: number): string {
  let s = '';
  let n = i + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = (n - 1 - r) / 26;
  }
  return s;
}

export function buildXlsx(rows: TestCell[][], options: BuildOptions = {}): Uint8Array {
  const p = options.prefix === undefined ? '' : `${options.prefix}:`;
  const xmlns = options.prefix === undefined ? `xmlns="${NS}"` : `xmlns:${options.prefix}="${NS}"`;
  const shared: string[] = [];
  const sharedIndex = new Map<string, number>();
  const sharedRef = (s: string) => {
    let i = sharedIndex.get(s);
    if (i === undefined) {
      i = shared.length;
      shared.push(s);
      sharedIndex.set(s, i);
    }
    return i;
  };

  const parts: string[] = [];
  rows.forEach((row, r) => {
    const cells: string[] = [];
    row.forEach((cell, c) => {
      const ref = `${colName(c)}${r + 1}`;
      if (cell === null) return;
      if (typeof cell === 'string') {
        if (options.sharedStrings === true) {
          cells.push(`<${p}c r="${ref}" t="s"><${p}v>${sharedRef(cell)}</${p}v></${p}c>`);
        } else {
          cells.push(
            `<${p}c r="${ref}" t="inlineStr"><${p}is><${p}t xml:space="preserve">${esc(cell)}</${p}t></${p}is></${p}c>`,
          );
        }
      } else if ('n' in cell) {
        cells.push(`<${p}c r="${ref}"><${p}v>${cell.n}</${p}v></${p}c>`);
      } else if ('s' in cell) {
        cells.push(`<${p}c r="${ref}" t="s"><${p}v>${sharedRef(cell.s)}</${p}v></${p}c>`);
      } else {
        cells.push(`<${p}c r="${ref}" t="b"><${p}v>${cell.b ? 1 : 0}</${p}v></${p}c>`);
      }
    });
    parts.push(`<${p}row r="${r + 1}">${cells.join('')}</${p}row>`);
  });

  const sheet = `<?xml version="1.0" encoding="UTF-8"?><${p}worksheet ${xmlns}><${p}sheetData>${parts.join('')}</${p}sheetData></${p}worksheet>`;
  const workbook =
    `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="${NS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<workbookPr${options.date1904 === true ? ' date1904="1"' : ''}/>` +
    `<sheets><sheet name="${esc(options.sheetName ?? 'Statement of Account')}" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  const rels =
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>' +
    '</Relationships>';
  const sst = `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="${NS}">${shared.map((s) => `<si><t xml:space="preserve">${esc(s)}</t></si>`).join('')}</sst>`;

  return zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types/>'),
    'xl/workbook.xml': strToU8(workbook),
    'xl/_rels/workbook.xml.rels': strToU8(rels),
    'xl/worksheets/sheet1.xml': strToU8(sheet),
    ...(shared.length > 0 ? { 'xl/sharedStrings.xml': strToU8(sst) } : {}),
  });
}

/** The BoG XLSX header row (row 15 of the real export), with its stray spaces. */
export const BOG_XLSX_HEADERS = [
  'Date',
  'Doc N',
  'Loro Account',
  'Debit',
  ' Credit',
  'Rate',
  'Debit Amount in Gel',
  'Credit Amount in Gel',
  'Entry Comment',
  'Operation Type',
  'Operation ID',
  'Ref',
  'Sender Name',
  'Sender Number Taxpayer',
  'Sender Account N',
  'Sender Bank Code',
  'Sender Bank Name',
  ' Recipient Name',
  'Recipient Number Taxpayer',
  'Recipient Account N',
  'Recipient Bank Code',
  'Recipient Bank Name',
  'Nomination',
  ' Additional Info',
  'Amount',
  'Amount in Gel',
  'Turnover Debit',
  'Turnover Credit',
  'Turnover Debit  in Gel',
  'Turnover Credit in Gel',
  'Balance at end of day',
  'Balance at end of day in Gel',
  'Balance',
  'Doc Payer Name',
  'Doc Payer Inn',
  'Destination Amount',
  'Destination Ccy',
];

export interface BogTestRow {
  serial: string;
  doc: string;
  loro: string;
  /** Signed decimal text, e.g. "-690.85". */
  amount: string;
  gel: string;
  code: string;
  opId: string;
  sender?: string;
  recipient?: string;
  comment?: string;
  destAmount?: string;
  destCcy?: string;
  balance?: string;
}

const strip = (s: string) => s.replace(/^-/, '');

/** A BoG-shaped workbook: metadata block, header row, data rows. */
export function buildBogXlsx(
  rows: BogTestRow[],
  meta: { currency?: string; opening?: string; closing?: string; account?: string } = {},
  options: BuildOptions = {},
): Uint8Array {
  const sheet: TestCell[][] = [
    [],
    [],
    [],
    ['Statement'],
    [null, 'Account Owner:', 'IE TEST OWNER'],
    [null, 'Number Taxpayer: ', '400000001'],
    [null, 'Account N:', meta.account ?? 'GE00BG0000000000000001GBP (1)'],
    [null, 'Currency: ', meta.currency ?? 'GBP'],
    [null, ' Period: ', '01.01.2025-31.12.2025'],
    [null, 'Begining Balance: ', meta.opening === undefined ? null : { n: meta.opening }],
    [null, 'Ending Balance: ', meta.closing === undefined ? null : { n: meta.closing }],
    [],
    [],
    [],
    BOG_XLSX_HEADERS,
  ];
  for (const r of rows) {
    const debit = r.amount.startsWith('-');
    const cells: TestCell[] = new Array<TestCell>(BOG_XLSX_HEADERS.length).fill(null);
    const set = (header: string, v: TestCell) => {
      cells[BOG_XLSX_HEADERS.indexOf(header)] = v;
    };
    set('Date', { n: r.serial });
    set('Doc N', r.doc);
    set('Loro Account', r.loro);
    set(debit ? 'Debit' : ' Credit', { n: strip(r.amount) });
    set(debit ? 'Debit Amount in Gel' : 'Credit Amount in Gel', { n: strip(r.gel) });
    set('Entry Comment', r.comment ?? 'Test operation');
    set('Operation Type', r.code);
    set('Operation ID', { n: r.opId });
    set('Sender Name', r.sender ?? null);
    set(' Recipient Name', r.recipient ?? null);
    set('Amount', { n: r.amount });
    set('Amount in Gel', { n: r.gel });
    set('Destination Amount', r.destAmount === undefined ? null : { n: r.destAmount });
    set('Destination Ccy', r.destCcy ?? null);
    set('Balance', r.balance === undefined ? null : { n: r.balance });
    sheet.push(cells);
  }
  return buildXlsx(sheet, { prefix: 'x', ...options });
}
