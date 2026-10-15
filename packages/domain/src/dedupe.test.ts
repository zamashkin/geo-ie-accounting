import { createHash } from 'node:crypto';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  DEDUPE_HASH_VERSION,
  dedupeHash,
  dedupeKey,
  normaliseReference,
  normaliseText,
} from './dedupe';
import type { DedupeInput } from './dedupe';
import { InvalidDateError } from './errors';
import { sha256Hex, utf8Encode } from './sha256';

const nodeSha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

describe('sha256Hex', () => {
  it.each([
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    [
      'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    ],
  ])('matches the FIPS 180-4 test vector for %j', (text, digest) => {
    expect(sha256Hex(utf8Encode(text))).toBe(digest);
  });

  it('property: equals node:crypto for any bytes, across block boundaries', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 300 }), (bytes) => {
        expect(sha256Hex(bytes)).toBe(nodeSha256(bytes));
      }),
    );
  });
});

describe('utf8Encode', () => {
  it('property: equals Buffer.from(text, "utf8"), lone surrogates included', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary' }), (text) => {
        expect(Buffer.from(utf8Encode(text))).toEqual(Buffer.from(text, 'utf8'));
      }),
    );
  });

  it('encodes Georgian text and astral characters', () => {
    expect(Buffer.from(utf8Encode('ქ€😀'))).toEqual(Buffer.from('ქ€😀', 'utf8'));
  });
});

describe('normalisation', () => {
  it('trims, collapses whitespace and lowercases text', () => {
    expect(normaliseText('  ACME   Ltd\t\n Invoice 7 ')).toBe('acme ltd invoice 7');
    // Georgian Mtavruli (capital) letters fold to Mkhedruli.
    expect(normaliseText('ᲡᲐᲥᲐᲠᲗᲕᲔᲚᲝ')).toBe('საქართველო');
    // NFKC: full-width and composed forms compare equal.
    expect(normaliseText('ＡＢＣ')).toBe('abc');
    expect(normaliseText('é')).toBe(normaliseText('é'));
  });

  it('strips punctuation, symbols and spaces from references', () => {
    expect(normaliseReference(' REF-123/45 ')).toBe('ref12345');
    expect(normaliseReference('ref 12345')).toBe('ref12345');
    expect(normaliseReference('#12.345|')).toBe('12345');
  });

  it('prefers the bank reference, then the document number, then counterparty + description', () => {
    const base = { counterparty: 'ACME', description: 'Invoice 7' };
    expect(dedupeKey({ ...base, bankReference: 'R-1', documentNumber: '9' })).toBe('ref:r1');
    expect(dedupeKey({ ...base, bankReference: ' - ', documentNumber: '9' })).toBe('doc:9');
    expect(dedupeKey({ ...base, bankReference: null })).toBe('txt:acme invoice 7');
    expect(
      dedupeKey({ ...base, bankReference: null, documentNumber: null, counterparty: null }),
    ).toBe('txt:invoice 7');
  });
});

describe('dedupeHash', () => {
  const row: DedupeInput = {
    accountId: '0199e8a0-0000-7000-8000-000000000001',
    bookedOn: '2025-06-05',
    amountMinor: 118_000n,
    currency: 'GBP',
    bankReference: '1234567890',
    counterparty: 'PETROV NIKOLAI',
    description: 'Incoming Transfer',
  };

  it('hashes the canonical, versioned input (ARCHITECTURE §6)', () => {
    expect(DEDUPE_HASH_VERSION).toBe(1);
    const canonical = `v1|0199e8a0-0000-7000-8000-000000000001|2025-06-05|118000|GBP|ref:1234567890`;
    expect(dedupeHash(row)).toBe(nodeSha256(Buffer.from(canonical, 'utf8')));
    expect(dedupeHash(row)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is stable under formatting noise', () => {
    expect(
      dedupeHash({
        ...row,
        accountId: row.accountId.toUpperCase(),
        currency: ' gbp ',
        bankReference: ' 12345-67890 ',
      }),
    ).toBe(dedupeHash(row));
    const textual = { ...row, bankReference: null };
    expect(
      dedupeHash({
        ...textual,
        counterparty: ' petrov   nikolai',
        description: 'INCOMING transfer ',
      }),
    ).toBe(dedupeHash(textual));
  });

  it('changes when any identifying field changes', () => {
    const variants: Partial<DedupeInput>[] = [
      { accountId: '0199e8a0-0000-7000-8000-000000000002' },
      { bookedOn: '2025-06-06' },
      { amountMinor: -118_000n },
      { amountMinor: 118_001n },
      { currency: 'USD' },
      { bankReference: '1234567891' },
    ];
    const hashes = new Set([dedupeHash(row), ...variants.map((v) => dedupeHash({ ...row, ...v }))]);
    expect(hashes.size).toBe(variants.length + 1);
  });

  it('does not confuse a reference with identical description text', () => {
    const asReference = dedupeHash({
      ...row,
      bankReference: 'abc',
      counterparty: null,
      description: '',
    });
    const asText = dedupeHash({
      ...row,
      bankReference: null,
      counterparty: null,
      description: 'abc',
    });
    expect(asReference).not.toBe(asText);
  });

  it('validates the booked date', () => {
    expect(() => dedupeHash({ ...row, bookedOn: '05.06.2025' })).toThrow(InvalidDateError);
  });
});
