// Renders a synthetic Bank of Georgia CSV statement (fixtures/statements/bog/FORMAT.md) for the
// demo seed, so demo transactions go through the real upload → preview → commit path.
import { formatDecimal, minorUnitExponent, type IsoDate } from '@geo-ie-accounting/domain';

export interface StatementLine {
  date: IsoDate;
  /** `sabuTis #`: `PMI…` makes an incoming payment; must be unique per account and date. */
  doc: string;
  /** Correspondent account: the payer's, or our own IBAN + currency for a conversion. */
  loro: string;
  /** Signed, in the statement currency: positive = credit (money in). */
  amountMinor: bigint;
  /** `kursi`: the NBG rate, or the bank's deal rate on a conversion. */
  rate: string;
  /** `eqv.lari`: the bank's GEL equivalent, unsigned. */
  gelMinor: bigint;
  description: string;
}

export interface Statement {
  ownerName: string;
  /** The bank's client code (not the tax ID). */
  clientCode: string;
  iban: string;
  currency: string;
  from: IsoDate;
  to: IsoDate;
  openingMinor: bigint;
  /** Rate and GEL equivalent printed next to the opening and closing balance. */
  openingRate: { rate: string; gelMinor: bigint };
  closingRate: { rate: string; gelMinor: bigint };
  lines: readonly StatementLine[];
}

const ddmmyyyy = (d: IsoDate) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`;
const ddmmyy = (d: IsoDate) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(2, 4)}`;
const quote = (s: string) => `"${s.replaceAll('"', '""')}"`;

/** The account number BoG prints after the IBAN: its last 9 digits. */
const accountNo = (iban: string) => iban.slice(-9);

export function renderBogCsv(s: Statement): string {
  const amount = (minor: bigint) => formatDecimal(minor, minorUnitExponent(s.currency));
  const gel = (minor: bigint) => formatDecimal(minor, 2);
  let debit = 0n;
  let credit = 0n;
  let balance = s.openingMinor;
  const rows: string[] = [
    `,,,${quote(`angariSis mflobeli: ${s.ownerName}`)},,,,`,
    `,,,${quote(`bankSi angariSis mflobelis kodi: ${s.clientCode}`)},,,,`,
    `,,,${quote(`angariSis #:${s.iban}${s.currency} (${accountNo(s.iban)})`)},,,,`,
    ',,,,,,,',
    `"centraluri filiali",,,"naerTi amonaweri piradi angariSidan",,,,`,
    `"q.Tbilisi, saqarTvelo",,,${quote(`periodi: ${ddmmyy(s.from)}-${ddmmyy(s.to)}`)},,,"bolo brunvis TariRi: ",,,,,,`,
    '"TariRi","sabuTis #","mokorespondento angariSi","debeti","krediti","kursi","eqv.lari","operaciis Sinaarsi"',
    `${quote(ddmmyyyy(s.from))},"sawyisi naSTi",,${quote(s.currency)},${amount(s.openingMinor)},${s.openingRate.rate},${gel(s.openingRate.gelMinor)},`,
  ];
  for (const line of s.lines) {
    const out = line.amountMinor < 0n;
    const abs = out ? -line.amountMinor : line.amountMinor;
    if (out) debit += abs;
    else credit += abs;
    balance += line.amountMinor;
    rows.push(
      [
        quote(ddmmyyyy(line.date)),
        quote(line.doc),
        quote(line.loro),
        out ? amount(abs) : '',
        out ? '' : amount(abs),
        line.rate,
        gel(line.gelMinor),
        quote(line.description),
      ].join(','),
    );
  }
  rows.push(`"sul brunva",,,${amount(debit)},${amount(credit)},,,`);
  rows.push(
    `${quote(ddmmyy(s.to))},"saboloo naSTi",,${quote(s.currency)},${amount(balance)},${s.closingRate.rate},${gel(s.closingRate.gelMinor)},`,
  );
  return `${rows.join('\r\n')}\r\n`;
}
