import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { buildXlsx } from '../test/build-xlsx';
import { columnIndex, decodeXml, readWorkbook, XlsxError } from './xlsx';

describe('readWorkbook', () => {
  it('reads inline strings, shared strings and exact number text', () => {
    const wb = readWorkbook(
      buildXlsx([['Date', { s: 'Amount' }], [{ n: '45812' }, { n: '-690.85' }], [{ b: true }]], {
        sheetName: 'S',
      }),
    );
    expect(wb.sheets[0]?.name).toBe('S');
    expect(wb.sheets[0]?.rows).toEqual([
      [
        { type: 'string', text: 'Date' },
        { type: 'string', text: 'Amount' },
      ],
      [
        { type: 'number', text: '45812' },
        { type: 'number', text: '-690.85' },
      ],
      [{ type: 'boolean', text: 'TRUE' }],
    ]);
  });

  it('handles namespace prefixes (BoG writes <x:row>)', () => {
    const wb = readWorkbook(buildXlsx([['a', { n: '1.0' }]], { prefix: 'x', sharedStrings: true }));
    expect(wb.sheets[0]?.rows[0]).toEqual([
      { type: 'string', text: 'a' },
      { type: 'number', text: '1.0' },
    ]);
  });

  it('keeps sparse cells at their column and fills missing rows', () => {
    const wb = readWorkbook(buildXlsx([[], [null, null, 'C2']]));
    expect(wb.sheets[0]?.rows[0]).toEqual([]);
    expect(wb.sheets[0]?.rows[1]?.[2]).toEqual({ type: 'string', text: 'C2' });
  });

  it('decodes entities, character references and _xHHHH_ escapes', () => {
    const sheet =
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' +
      '<row r="1"><c r="A1" t="inlineStr"><is><t>&quot;JSC&quot; &amp; &#x10D0;_x000D_</t></is></c>' +
      '<c r="B1" t="inlineStr"><is><r><t>rich </t></r><r><t>text</t></r><rPh><t>skip</t></rPh></is></c>' +
      '<c t="str"><v>no ref</v></c></row></sheetData></worksheet>';
    const bytes = zipSync({
      'xl/workbook.xml': strToU8(
        '<workbook><sheets><sheet name="A" sheetId="1"/></sheets></workbook>',
      ),
      'xl/worksheets/sheet1.xml': strToU8(sheet),
    });
    const row = readWorkbook(bytes).sheets[0]?.rows[0];
    expect(row?.map((c) => c?.text)).toEqual(['"JSC" & ა\r', 'rich text', 'no ref']);
  });

  it('reads the 1904 date-system flag', () => {
    expect(readWorkbook(buildXlsx([['a']], { date1904: true })).date1904).toBe(true);
    expect(readWorkbook(buildXlsx([['a']])).date1904).toBe(false);
  });

  it('throws XlsxError for non-workbooks', () => {
    expect(() => readWorkbook(new Uint8Array([1, 2, 3]))).toThrow(XlsxError);
    expect(() => readWorkbook(zipSync({ 'a.txt': strToU8('x') }))).toThrow(XlsxError);
    const truncated = buildXlsx([['a']]).subarray(0, 60);
    expect(() => readWorkbook(truncated)).toThrow(XlsxError);
  });
});

describe('helpers', () => {
  it('columnIndex', () => {
    expect(columnIndex('A1')).toBe(0);
    expect(columnIndex('Z9')).toBe(25);
    expect(columnIndex('AA1')).toBe(26);
    expect(columnIndex('AK20')).toBe(36);
    expect(columnIndex('$B$2')).toBe(1);
    expect(columnIndex('1A')).toBe(-1);
  });

  it('decodeXml leaves unknown entities alone', () => {
    expect(decodeXml('a &bogus; &lt;b&gt;')).toBe('a &bogus; <b>');
  });
});
