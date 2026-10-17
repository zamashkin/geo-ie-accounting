import type { CurrencyCode } from './currency';
import type { IsoDate } from './date';
import { daysBetween } from './tax/filing';

// Payment matching (WS-09): how well an incoming bank payment fits an issued invoice. Pure
// scoring; the API loads the unmatched incoming payments and the open invoices.
//
// A payment qualifies when
//   - it is in the invoice currency (no FX: a USD invoice is paid in USD),
//   - it arrived on or after the issue date,
//   - its amount equals what is still owed, or is less (a partial payment), or more (one
//     transfer settling several invoices; only what is owed is allocated),
//   - and the bank's counterparty resembles the client name. An exact amount is enough on its
//     own when the statement has no counterparty.
// Scores are integers 0..100, never money.

export type AmountMatch = 'exact' | 'partial' | 'over';

export interface MatchableInvoice {
  readonly currency: CurrencyCode;
  /** Total − paid, minor units. */
  readonly outstandingMinor: bigint;
  readonly issueDate: IsoDate;
  readonly dueDate: IsoDate | null;
  readonly clientName: string;
}

export interface MatchablePayment {
  readonly currency: CurrencyCode;
  /** What is still unallocated of the incoming amount, minor units, > 0. */
  readonly availableMinor: bigint;
  readonly occurredOn: IsoDate;
  readonly counterparty: string | null;
}

export interface PaymentMatch {
  /** 0..100, higher is better. */
  readonly score: number;
  readonly amountMatch: AmountMatch;
  /** Counterparty vs client name, 0..100; null when the statement has no counterparty. */
  readonly nameScore: number | null;
  /** What confirming the match allocates: the smaller of available and outstanding. */
  readonly allocateMinor: bigint;
}

/** A name this similar (0..100) counts as the client. */
export const NAME_MATCH_THRESHOLD = 60;

const AMOUNT_POINTS: Record<AmountMatch, number> = { exact: 50, partial: 25, over: 20 };
const NAME_WEIGHT = 40;
const DATE_POINTS_MAX = 10;

// Legal forms and filler that say nothing about who paid: English, German, French, Russian
// and Georgian (after transliteration: შპს → shps, სს → ss, ი/მ → i m).
const STOP_WORDS = new Set([
  'llc',
  'ltd',
  'limited',
  'inc',
  'incorporated',
  'corp',
  'corporation',
  'co',
  'company',
  'gmbh',
  'ag',
  'sa',
  'sarl',
  'sas',
  'bv',
  'nv',
  'oy',
  'ab',
  'as',
  'plc',
  'srl',
  'spa',
  'ooo',
  'llp',
  'lp',
  'the',
  'and',
  'of',
  'shps',
  'ss',
  'ie',
]);

// Georgian national transliteration, so a Georgian client name matches the Latin spelling a
// bank statement prints.
const GEORGIAN: Record<string, string> = {
  ა: 'a',
  ბ: 'b',
  გ: 'g',
  დ: 'd',
  ე: 'e',
  ვ: 'v',
  ზ: 'z',
  თ: 't',
  ი: 'i',
  კ: 'k',
  ლ: 'l',
  მ: 'm',
  ნ: 'n',
  ო: 'o',
  პ: 'p',
  ჟ: 'zh',
  რ: 'r',
  ს: 's',
  ტ: 't',
  უ: 'u',
  ფ: 'p',
  ქ: 'k',
  ღ: 'gh',
  ყ: 'q',
  შ: 'sh',
  ჩ: 'ch',
  ც: 'ts',
  ძ: 'dz',
  წ: 'ts',
  ჭ: 'ch',
  ხ: 'kh',
  ჯ: 'j',
  ჰ: 'h',
};

/**
 * Comparable tokens of a name: transliterated, accents and case dropped, punctuation split,
 * legal forms and one-letter tokens removed. `"ACME Software, L.L.C."` → `['acme', 'software']`.
 */
export function nameTokens(name: string): string[] {
  const latin = name.replace(/[\u10D0-\u10FF]/g, (c) => GEORGIAN[c] ?? c);
  const plain = latin
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    // "L.L.C." and "S.A." are one token once the dots between single letters go.
    .replace(/\b(\p{L})\.(?=\p{L}\b)/gu, '$1')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
  if (plain === '') return [];
  return plain.split(' ').filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}

function bigrams(text: string): Map<string, number> {
  const grams = new Map<string, number>();
  for (let i = 0; i < text.length - 1; i++) {
    const g = text.slice(i, i + 2);
    grams.set(g, (grams.get(g) ?? 0) + 1);
  }
  return grams;
}

/** Sørensen–Dice over character bigrams, 0..100. Tolerates typos and truncation. */
function bigramDice(a: string, b: string): number {
  if (a === b) return 100;
  if (a.length < 2 || b.length < 2) return 0;
  const ga = bigrams(a);
  const gb = bigrams(b);
  let shared = 0;
  for (const [g, n] of ga) shared += Math.min(n, gb.get(g) ?? 0);
  return Math.floor((200 * shared) / (a.length - 1 + (b.length - 1)));
}

/**
 * How alike two names are, 0..100, ignoring word order, case, accents, punctuation and legal
 * forms. The best of: shared words (Dice), the shorter name's words all inside the longer one,
 * and character bigrams over the sorted words (typos, "Acme Sofware").
 */
export function nameSimilarity(a: string, b: string): number {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (ta.length === 0 || tb.length === 0) return 0;
  const sa = new Set(ta);
  const sb = new Set(tb);
  let shared = 0;
  for (const t of sa) if (sb.has(t)) shared += 1;
  const tokenDice = Math.floor((200 * shared) / (sa.size + sb.size));
  const [small, large] = sa.size <= sb.size ? [sa, sb] : [sb, sa];
  // "Acme" paid for "Acme Software": every word of the shorter name is in the longer one.
  const contained = [...small].every((t) => large.has(t)) ? 85 : 0;
  const fuzzy = bigramDice([...sa].sort().join(' '), [...sb].sort().join(' '));
  return Math.max(tokenDice, contained, fuzzy);
}

/** 10 points within 45 days of the issue date (or by the due date), 5 within 90, else 0. */
function datePoints(invoice: MatchableInvoice, paidOn: IsoDate): number {
  if (invoice.dueDate !== null && paidOn <= invoice.dueDate) return DATE_POINTS_MAX;
  const days = daysBetween(invoice.issueDate, paidOn);
  if (days <= 45) return DATE_POINTS_MAX;
  if (days <= 90) return DATE_POINTS_MAX / 2;
  return 0;
}

/** How `payment` fits `invoice`, or null when it cannot pay it (see the rules above). */
export function scorePaymentMatch(
  invoice: MatchableInvoice,
  payment: MatchablePayment,
): PaymentMatch | null {
  if (payment.currency !== invoice.currency) return null;
  if (payment.availableMinor <= 0n || invoice.outstandingMinor <= 0n) return null;
  if (payment.occurredOn < invoice.issueDate) return null;

  const amountMatch: AmountMatch =
    payment.availableMinor === invoice.outstandingMinor
      ? 'exact'
      : payment.availableMinor < invoice.outstandingMinor
        ? 'partial'
        : 'over';
  const counterparty = payment.counterparty?.trim() ? payment.counterparty : null;
  const nameScore = counterparty === null ? null : nameSimilarity(invoice.clientName, counterparty);

  const nameMatches = nameScore !== null && nameScore >= NAME_MATCH_THRESHOLD;
  // Without a counterparty only an exact amount is evidence enough.
  if (!nameMatches && !(nameScore === null && amountMatch === 'exact')) return null;

  const namePoints = nameScore === null ? 0 : Math.floor((nameScore * NAME_WEIGHT) / 100);
  const score = AMOUNT_POINTS[amountMatch] + namePoints + datePoints(invoice, payment.occurredOn);
  return {
    score,
    amountMatch,
    nameScore,
    allocateMinor:
      payment.availableMinor < invoice.outstandingMinor
        ? payment.availableMinor
        : invoice.outstandingMinor,
  };
}

/** Best first: higher score, then the earlier payment. */
export function compareMatches(
  a: { readonly match: PaymentMatch; readonly occurredOn: IsoDate },
  b: { readonly match: PaymentMatch; readonly occurredOn: IsoDate },
): number {
  if (a.match.score !== b.match.score) return b.match.score - a.match.score;
  return a.occurredOn < b.occurredOn ? -1 : a.occurredOn > b.occurredOn ? 1 : 0;
}
