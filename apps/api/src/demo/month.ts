// One month of bank activity for a demo workspace: the lines of each currency account's
// statement, with running balances so no account goes below zero. Amounts are bigint minor
// units; GEL equivalents and conversion amounts come from packages/domain (`toGel`).
import {
  BASE_CURRENCY,
  formatDecimal,
  formatRate,
  money,
  periodOf,
  toGel,
  type IsoDate,
  type Period,
} from '@geo-ie-accounting/domain';
import { isWeekday, lastWeekday, weekdayFrom } from './calendar';
import type { DemoWorkspace } from './profile';
import type { Random } from './random';
import type { DemoRates } from './rates';
import type { StatementLine } from './statement';

export const FOREIGN = ['USD', 'EUR', 'GBP'] as const;
export const CURRENCIES = [BASE_CURRENCY, ...FOREIGN] as const;

/** What a statement line should book against, by the seed's own account keys. */
export type BookAs =
  | 'sbs_income'
  | 'interest'
  | 'fx_clearing'
  | 'tax_payable'
  | 'owner_equity'
  | 'bank_fees'
  | 'software'
  | 'coworking'
  | 'unassigned';

export interface PlannedLine extends StatementLine {
  currency: string;
  bookAs: BookAs;
  /** An incoming payment for an invoice: matched to it after the commit. */
  invoiceId?: string;
  /** A supplier refund that the default suggestion books as income (the drift story). */
  refund?: boolean;
  /** Sort key within a day: money in first. */
  order: number;
}

/** An invoice payment the client will make. */
export interface ExpectedPayment {
  invoiceId: string;
  number: string;
  clientKey: string;
  sender: { name: string; address: string; account: string; bank: string };
  currency: string;
  amountMinor: bigint;
  date: IsoDate;
}

export interface MonthInput {
  ws: DemoWorkspace;
  period: Period;
  /** Lines on or after this date have not happened yet. */
  asOf: IsoDate;
  rng: Random;
  rates: DemoRates;
  /** Closing balance of each account last month. */
  balances: Map<string, bigint>;
  payments: readonly ExpectedPayment[];
  /** Small-business tax of last month, paid this month (null: nothing to pay). */
  taxToPay: { period: Period; amountMinor: bigint } | null;
  /** Lines made outside the usual pattern (the supplier refund). */
  extra?: readonly PlannedLine[];
  docSeq: { next: () => number };
}

const thousands = (minor: bigint, currency: string) => {
  const [int = '0', frac] = formatDecimal(minor, 2).split('.');
  return `${currency}${int.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${frac ?? '00'}`;
};

const yymmdd = (d: IsoDate) => d.replaceAll('-', '').slice(2);

function incomingDescription(
  owner: string,
  amount: string,
  sender: ExpectedPayment['sender'],
  details: string,
) {
  const who = owner.replace(/^IE /, '');
  return (
    `${who}: \n\t  Incoming Transfer - Amount: ${amount}; Sender: ${sender.name}\\${sender.address}; ` +
    `Account: ${sender.account}; Bank: ${sender.bank}; Details: ${details}`
  );
}

/** Builds the month. Returns the lines per currency in statement order and the new balances. */
export async function planMonth(input: MonthInput): Promise<{
  lines: Map<string, PlannedLine[]>;
  balances: Map<string, bigint>;
}> {
  const { ws, period, asOf, rng, rates } = input;
  const happened = (d: IsoDate) => d < asOf && d >= ws.startsOn && periodOf(d) === period;
  const year = Number(period.slice(0, 4));
  const byCcy = new Map<string, PlannedLine[]>(CURRENCIES.map((c) => [c, []]));
  const push = (line: PlannedLine) => {
    if (happened(line.date)) byCcy.get(line.currency)?.push(line);
  };
  const doc = (prefix: string, date: IsoDate) =>
    `${prefix}${yymmdd(date)}${String(input.docSeq.next()).padStart(6, '0')}`;
  const gelOf = (currency: string, minor: bigint, date: IsoDate) =>
    rates.gelOn(currency, minor, date);
  const rateText = async (currency: string, date: IsoDate) =>
    currency === BASE_CURRENCY ? '1.0000' : (await rates.rateOn(currency, date)).rate;

  // ── Money in: invoice payments, and one supplier refund in the drift month ─────────────
  for (const p of input.payments) {
    if (!happened(p.date)) continue;
    push({
      currency: p.currency,
      date: p.date,
      doc: doc('PMI', p.date),
      loro: p.sender.account,
      amountMinor: p.amountMinor,
      rate: await rateText(p.currency, p.date),
      gelMinor: await gelOf(p.currency, p.amountMinor, p.date),
      description: incomingDescription(
        ws.statementOwner,
        thousands(p.amountMinor, p.currency),
        p.sender,
        `INVOICE ${p.number}`,
      ),
      bookAs: 'sbs_income',
      invoiceId: p.invoiceId,
      order: 0,
    });
  }

  for (const line of input.extra ?? []) push(line);

  // ── Card payments and subscriptions ────────────────────────────────────────────────────
  const card = async (currency: string, day: number, minor: bigint, merchant: string) => {
    const date = weekdayFrom(period, day);
    if (!happened(date)) return;
    push({
      currency,
      date,
      doc: doc('CRD', date),
      loro: '',
      amountMinor: -minor,
      rate: await rateText(currency, date),
      gelMinor: await gelOf(currency, minor, date),
      description: `Card payment ${merchant} ${thousands(minor, currency)}`,
      bookAs: 'software',
      order: 2,
    });
  };
  await card('USD', 3, 400n, 'GITHUB.COM SF US');
  await card('USD', 4, rng.bigint(1_200n, 4_800n), 'AWS EMEA SARL LU');
  await card('USD', 11, 2_890n, 'JETBRAINS AMERICAS INC');
  if (year >= 2026) await card('USD', 16, 1_500n, 'FIGMA INC SAN FRANCISCO');
  await card('EUR', 6, rng.bigint(650n, 1_390n), 'HETZNER ONLINE GMBH');

  // ── Conversions to GEL (each with its GEL leg) ─────────────────────────────────────────
  const conversionDays = [rng.int(13, 18), rng.int(22, 25)];
  const balances = new Map(input.balances);
  const sorted = (ccy: string) =>
    (byCcy.get(ccy) ?? []).sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order);
  const balanceOn = (ccy: string, date: IsoDate, opening: bigint) =>
    sorted(ccy)
      .filter((l) => l.date <= date)
      .reduce((s, l) => s + l.amountMinor, opening);

  for (const ccy of FOREIGN) {
    const opening = balances.get(ccy) ?? 0n;
    for (const day of conversionDays) {
      const date = weekdayFrom(period, day);
      if (!happened(date)) continue;
      const keep = rng.bigint(15_000n, 45_000n);
      const sold = ((balanceOn(ccy, date, opening) - keep) / 10_000n) * 10_000n;
      if (sold <= 0n) continue;
      const nbg = await rates.fxRate(ccy, date);
      // The bank's deal rate is a little below NBG's.
      const deal = {
        rateScaled: nbg.rateScaled - rng.bigint(5_000n, 14_000n),
        quantity: nbg.quantity,
      };
      const bought = toGel(money(sold, ccy), deal).amountMinor;
      const docNo = doc('', date);
      const dealText = formatRate(deal.rateScaled);
      const text = (counter: string) =>
        ` Payment - Amount ${thousands(sold, ccy)}; Foreign Exchange. FX Rate:${dealText}. ` +
        `Counter-amount: ${counter}. Currency Exchange`;
      push({
        currency: ccy,
        date,
        doc: docNo,
        loro: `${ws.iban}${BASE_CURRENCY}`,
        amountMinor: -sold,
        rate: dealText,
        gelMinor: await gelOf(ccy, sold, date),
        description: text(thousands(bought, BASE_CURRENCY)),
        bookAs: 'fx_clearing',
        order: 3,
      });
      push({
        currency: BASE_CURRENCY,
        date,
        doc: docNo,
        loro: `${ws.iban}${ccy}`,
        amountMinor: bought,
        rate: dealText,
        gelMinor: bought,
        description: text(thousands(sold, ccy)),
        bookAs: 'fx_clearing',
        order: 0,
      });
    }
  }

  // ── GEL account: rent, bank fee, tax, interest, owner draws ────────────────────────────
  const gel = (
    date: IsoDate,
    amountMinor: bigint,
    description: string,
    bookAs: BookAs,
    prefix: string,
  ) => {
    push({
      currency: BASE_CURRENCY,
      date,
      doc: doc(prefix, date),
      loro: prefix === 'INT' ? '' : 'GE00TR0000000000000001',
      amountMinor,
      rate: '1.0000',
      gelMinor: amountMinor < 0n ? -amountMinor : amountMinor,
      description,
      bookAs,
      order: amountMinor > 0n ? 1 : 4,
    });
  };
  const rent = year >= 2026 ? 52_000n : 45_000n;
  gel(
    weekdayFrom(period, 5),
    -rent,
    'Transfer to TBILISI EXAMPLE HUB LLC: coworking membership',
    'coworking',
    'OUT',
  );
  if (input.taxToPay) {
    gel(
      weekdayFrom(period, rng.int(9, 13)),
      -input.taxToPay.amountMinor,
      `Treasury transfer: small business tax ${input.taxToPay.period}`,
      'tax_payable',
      'TRS',
    );
  }
  if (['03', '06', '09', '12'].includes(period.slice(5, 7))) {
    gel(
      lastWeekday(period),
      rng.bigint(900n, 3_400n),
      'Interest accrued on savings',
      'interest',
      'INT',
    );
  }
  gel(lastWeekday(period), -500n, 'Monthly account service fee', 'bank_fees', 'FEE');

  // Owner draws, after this month's other payments are covered: a round sum mid-month, then
  // most of what is left at the end, keeping a small reserve.
  const gelOpening = balances.get(BASE_CURRENCY) ?? 0n;
  for (const [i, day] of [rng.int(7, 11), rng.int(26, 28)].entries()) {
    const date = weekdayFrom(period, day);
    if (!happened(date) || !isWeekday(date)) continue;
    const later = sorted(BASE_CURRENCY)
      .filter((l) => l.date > date && l.amountMinor < 0n)
      .reduce((s, l) => s - l.amountMinor, 0n);
    const spare = balanceOn(BASE_CURRENCY, date, gelOpening) - later - 30_000n;
    const wanted =
      i === 0
        ? rng.bigint(ws.drawMinor[0], ws.drawMinor[1])
        : spare - rng.bigint(ws.drawMinor[0], ws.drawMinor[1]);
    const amount = ((wanted < spare ? wanted : spare) / 5_000n) * 5_000n;
    if (amount < 20_000n) continue;
    gel(date, -amount, 'Transfer to own card **** 4417', 'owner_equity', 'OWN');
  }

  // Drop outflows the account cannot cover (the first weeks, before any income arrived).
  const lines = new Map<string, PlannedLine[]>();
  for (const ccy of CURRENCIES) {
    let balance = balances.get(ccy) ?? 0n;
    const kept: PlannedLine[] = [];
    for (const line of sorted(ccy)) {
      if (balance + line.amountMinor < 0n) continue;
      balance += line.amountMinor;
      kept.push(line);
    }
    lines.set(ccy, kept);
    balances.set(ccy, balance);
  }
  return { lines, balances };
}

/** The supplier refund of the drift story: money in that is not income. */
export async function refundLine(
  ws: DemoWorkspace,
  date: IsoDate,
  rates: DemoRates,
  docNo: string,
): Promise<PlannedLine> {
  const amountMinor = 12_000n;
  return {
    currency: 'USD',
    date,
    doc: docNo,
    loro: 'US00EXMP0000000000090009',
    amountMinor,
    rate: (await rates.rateOn('USD', date)).rate,
    gelMinor: await rates.gelOn('USD', amountMinor, date),
    description: incomingDescription(
      ws.statementOwner,
      thousands(amountMinor, 'USD'),
      {
        name: 'CLOUDNINE HOSTING LTD',
        address: '9 EXAMPLE QUAY, DUBLIN,IE',
        account: 'US00EXMP0000000000090009',
        bank: 'EXAMPLE TRUST BANK EXMPIE2D',
      },
      'REFUND OF DUPLICATE CHARGE',
    ),
    bookAs: 'sbs_income',
    refund: true,
    order: 0,
  };
}
