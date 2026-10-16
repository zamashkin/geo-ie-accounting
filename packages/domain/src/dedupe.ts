import { assertIsoDate } from './date';
import type { IsoDate } from './date';
import type { CurrencyCode } from './currency';
import { sha256Hex, utf8Encode } from './sha256';

// Deterministic duplicate detection for imported bank lines (ARCHITECTURE §6):
//   dedupe_hash = sha256(accountId | bookedOn | amountMinor | currency | key)
// where key is the normalised bank reference, else the statement document number (BoG CSV has no
// operation id, FORMAT.md), else counterparty + description. The key is tagged with its kind so
// a reference can never collide with a description that happens to read the same.
//
// Changing anything here changes every stored hash; bump DEDUPE_HASH_VERSION and plan a
// migration of `transaction_fingerprints` if that is ever needed.

export const DEDUPE_HASH_VERSION = 1;

export interface DedupeInput {
  readonly accountId: string;
  readonly bookedOn: IsoDate;
  readonly amountMinor: bigint;
  readonly currency: CurrencyCode;
  readonly bankReference: string | null;
  readonly documentNumber?: string | null;
  readonly counterparty: string | null;
  readonly description: string;
}

/** NFKC, trim, collapse internal whitespace to one space, lowercase (locale-independent). */
export function normaliseText(text: string): string {
  return text.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();
}

/**
 * Text normalisation plus: punctuation, symbols and whitespace removed. Banks print the same
 * reference as `REF-123/45`, `ref 12345` or `REF12345` depending on the export.
 */
export function normaliseReference(reference: string): string {
  return normaliseText(reference).replace(/[\p{P}\p{S}\s]/gu, '');
}

/** The tagged free-text part of the hash input. */
export function dedupeKey(
  input: Pick<DedupeInput, 'bankReference' | 'documentNumber' | 'counterparty' | 'description'>,
): string {
  const reference = normaliseReference(input.bankReference ?? '');
  if (reference !== '') return `ref:${reference}`;
  const documentNumber = normaliseReference(input.documentNumber ?? '');
  if (documentNumber !== '') return `doc:${documentNumber}`;
  return `txt:${normaliseText(`${input.counterparty ?? ''} ${input.description}`)}`;
}

/** Lowercase hex SHA-256 of the canonical, versioned hash input. */
export function dedupeHash(input: DedupeInput): string {
  assertIsoDate(input.bookedOn);
  const canonical = [
    `v${DEDUPE_HASH_VERSION}`,
    input.accountId.trim().toLowerCase(),
    input.bookedOn,
    input.amountMinor.toString(),
    input.currency.trim().toUpperCase(),
    // Free text last: whatever it contains cannot shift the fields before it.
    dedupeKey(input),
  ].join('|');
  return sha256Hex(utf8Encode(canonical));
}

/**
 * Second fingerprint, keyed on the statement document number; null when the line has none.
 *
 * The same BoG operation hashes differently in the XLSX export (it has an `Operation ID`) and in
 * the CSV export (it does not), because `dedupeHash` prefers the bank reference. Both exports
 * print the same document number. Storing this hash next to the primary one lets a CSV
 * re-import find lines first imported from the XLSX, and the other way round: account + date +
 * amount + document number.
 */
export function documentDedupeHash(input: DedupeInput): string | null {
  if (normaliseReference(input.documentNumber ?? '') === '') return null;
  return dedupeHash({ ...input, bankReference: null });
}

/** Every fingerprint of a line: the primary hash first, then the document-number hash if any. */
export function dedupeHashes(input: DedupeInput): string[] {
  const primary = dedupeHash(input);
  const byDocument = documentDedupeHash(input);
  return byDocument === null || byDocument === primary ? [primary] : [primary, byDocument];
}
