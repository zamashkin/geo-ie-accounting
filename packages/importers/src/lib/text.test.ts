import { describe, expect, it } from 'vitest';
import { collapseLines, decodeText, looksBinary, normaliseLabel, swiftName } from './text';

describe('swiftName', () => {
  it('takes the name line before the address lines', () => {
    expect(
      swiftName('EXAMPLE CLIENT LIMITED\\1 SAMPLE STREET, LONDON, ENGLAND,1 \\SAMPLE STREET'),
    ).toBe('EXAMPLE CLIENT LIMITED');
  });

  it('joins a name that was cut at exactly 35 characters', () => {
    expect(swiftName('PETROV NIKOLAI SERGEEVICH PETROV NI\\KOLAI SERGEEVICH')).toBe(
      'PETROV NIKOLAI SERGEEVICH PETROV NIKOLAI SERGEEVICH',
    );
  });

  it('handles fields without wraps', () => {
    expect(swiftName('  IE NIKOLAI PETROV ')).toBe('IE NIKOLAI PETROV');
    expect(swiftName('')).toBe('');
  });
});

describe('decodeText', () => {
  const enc = (s: string) => new TextEncoder().encode(s);

  it('strips a UTF-8 BOM', () => {
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, ...enc('a,b')]))).toMatchObject({
      text: 'a,b',
      fallback: false,
    });
  });

  it('decodes UTF-16LE with BOM', () => {
    const bytes = new Uint8Array([0xff, 0xfe, 0x61, 0x00, 0x3b, 0x00, 0x62, 0x00]);
    expect(decodeText(bytes)).toMatchObject({ text: 'a;b', encoding: 'utf-16le' });
  });

  it('decodes Georgian UTF-8', () => {
    expect(decodeText(enc('თარიღი')).text).toBe('თარიღი');
  });

  it('falls back to windows-1252 for invalid UTF-8', () => {
    expect(decodeText(new Uint8Array([0x61, 0xe9, 0x62]))).toMatchObject({
      text: 'aéb',
      fallback: true,
    });
  });
});

describe('helpers', () => {
  it('collapseLines folds BoG continuation lines', () => {
    expect(collapseLines('NAME: \r\n\t  Incoming Transfer')).toBe('NAME: Incoming Transfer');
    expect(collapseLines(' Payment - x ')).toBe('Payment - x');
  });

  it('normaliseLabel trims stray spaces, colons and case', () => {
    expect(normaliseLabel(' Period: ')).toBe('period');
    expect(normaliseLabel('Turnover Debit  in Gel')).toBe('turnover debit in gel');
    expect(normaliseLabel(' Credit')).toBe('credit');
  });

  it('looksBinary', () => {
    expect(looksBinary(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00]))).toBe(true);
    expect(looksBinary(new TextEncoder().encode('a,b\r\n\t1,2'))).toBe(false);
  });
});
