import { describe, expect, it } from 'vitest';
import { parseCsv, sniffDelimiter } from './csv';

const cells = (text: string, d: ',' | ';' | '\t' = ',') =>
  parseCsv(text, d).records.map((r) => r.cells);

describe('parseCsv', () => {
  it('splits simple records', () => {
    expect(cells('a,b,c\n1,2,3\n')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('handles mixed CRLF, LF and CR line endings', () => {
    expect(cells('a\r\nb\nc\rd')).toEqual([['a'], ['b'], ['c'], ['d']]);
  });

  it('keeps line breaks, tabs and delimiters inside quoted fields', () => {
    const { records } = parseCsv('"x","line1: \r\n\t  line2, still",y\nnext', ',');
    expect(records[0]?.cells).toEqual(['x', 'line1: \r\n\t  line2, still', 'y']);
    expect(records[1]).toEqual({ line: 3, cells: ['next'] });
  });

  it('unescapes doubled quotes', () => {
    expect(cells('"say ""hi""",b')).toEqual([['say "hi"', 'b']]);
  });

  it('treats backslash as an ordinary character', () => {
    expect(cells('"PETROV NI\\KOLAI","a\\"\n')).toEqual([['PETROV NI\\KOLAI', 'a\\']]);
  });

  it('keeps empty fields and trailing delimiters', () => {
    expect(cells(',,,"x",,\n')).toEqual([['', '', '', 'x', '', '']]);
  });

  it('is lenient with malformed quoting', () => {
    expect(cells('ab"c,d')).toEqual([['ab"c', 'd']]);
    expect(cells('"ab"c,d')).toEqual([['abc', 'd']]);
    const r = parseCsv('a,"never closed\nb,c', ',');
    expect(r.unterminatedQuoteLine).toBe(1);
    expect(r.records).toEqual([{ line: 1, cells: ['a', 'never closed\nb,c'] }]);
  });

  it('returns nothing for empty input', () => {
    expect(parseCsv('', ',').records).toEqual([]);
  });

  it('supports ; and tab delimiters', () => {
    expect(cells('a;b\n1,5;2', ';')).toEqual([
      ['a', 'b'],
      ['1,5', '2'],
    ]);
    expect(cells('a\tb', '\t')).toEqual([['a', 'b']]);
  });
});

describe('sniffDelimiter', () => {
  it.each([
    ['date,amount,desc\n2025-01-01,1.00,x\n2025-01-02,2.00,y', ','],
    ['date;amount;desc\n01.01.2025;1,00;x\n02.01.2025;2,00;y', ';'],
    ['date\tamount\n2025-01-01\t1.00', '\t'],
    ['"a;b",c\n"d;e",f', ','],
  ] as const)('%j -> %j', (text, d) => {
    expect(sniffDelimiter(text)).toBe(d);
  });
});
