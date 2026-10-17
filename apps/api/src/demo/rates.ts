// Real NBG rates for the demo seed, recorded once into fixtures/nbg/demo-rates.json
// (`pnpm --filter @geo-ie-accounting/nbg record-demo-rates`). The seed stores them and books
// with them; only a date after the recorded range goes to NBG.
import { readFileSync } from 'node:fs';
import { CurrencyCode, IsoDate, RateDecimal } from '@geo-ie-accounting/contracts';
import type { NewExchangeRate, RateSource } from '@geo-ie-accounting/db';
import { BASE_CURRENCY, money, parseRate, toGel, type FxRate } from '@geo-ie-accounting/domain';
import { nbgSetTimeToUtc } from '@geo-ie-accounting/nbg';
import { z } from 'zod';

const FIXTURE = new URL('../../../../fixtures/nbg/demo-rates.json', import.meta.url);

const DemoRatesFile = z.object({
  requestedFrom: IsoDate,
  requestedTo: IsoDate,
  rates: z.array(
    z.object({
      currency: CurrencyCode,
      validFrom: IsoDate,
      rate: RateDecimal,
      quantity: z.int().positive(),
      /** NBG's set time: Tbilisi wall-clock with a `Z` suffix. */
      setAt: z.string(),
    }),
  ),
});

export interface DemoRate {
  currency: string;
  validFrom: string;
  rate: string;
  quantity: number;
  setAt: string;
}

export class DemoRates implements RateSource {
  /** Last date the recording asked NBG for: the fixture proves every date up to it. */
  readonly coveredTo: string;
  readonly coveredFrom: string;
  private readonly byCurrency = new Map<string, DemoRate[]>();

  constructor(
    rows: readonly DemoRate[],
    range: { from: string; to: string },
    /** Asked for dates after `coveredTo`; null fails them instead. */
    private readonly live: RateSource | null,
  ) {
    this.coveredFrom = range.from;
    this.coveredTo = range.to;
    for (const r of rows) {
      const list = this.byCurrency.get(r.currency) ?? [];
      list.push(r);
      this.byCurrency.set(r.currency, list);
    }
    for (const list of this.byCurrency.values()) {
      list.sort((a, b) => a.validFrom.localeCompare(b.validFrom));
    }
  }

  static load(live: RateSource | null): DemoRates {
    const file = DemoRatesFile.parse(JSON.parse(readFileSync(FIXTURE, 'utf8')) as unknown);
    const rows = file.rates.map((r) => ({ ...r, setAt: nbgSetTimeToUtc(r.setAt) }));
    return new DemoRates(rows, { from: file.requestedFrom, to: file.requestedTo }, live);
  }

  /** Rows for `upsertRates`. */
  rows(): NewExchangeRate[] {
    return [...this.byCurrency.values()].flat().map((r) => ({
      currency: r.currency,
      validFrom: r.validFrom,
      rate: r.rate,
      quantity: r.quantity,
      setAt: new Date(r.setAt),
    }));
  }

  /** The rate valid on `date` (SPEC §2.3): the newest row with `validFrom <= date`. */
  async rateOn(currency: string, date: string): Promise<DemoRate> {
    if (date > this.coveredTo || date < this.coveredFrom) {
      if (!this.live) {
        throw new Error(
          `No recorded NBG ${currency} rate for ${date}: the fixture covers ` +
            `${this.coveredFrom}..${this.coveredTo}. Re-record it or set DEMO_TODAY.`,
        );
      }
      const [fetched] = await this.live.getRates(date, [currency]);
      if (!fetched) throw new Error(`NBG returned no ${currency} rate for ${date}`);
      const setAt = fetched.setAt instanceof Date ? fetched.setAt.toISOString() : fetched.setAt;
      const row = { ...fetched, setAt: setAt ?? `${fetched.validFrom}T13:00:00.000Z` };
      const list = this.byCurrency.get(currency) ?? [];
      if (!list.some((r) => r.validFrom === row.validFrom)) {
        list.push(row);
        list.sort((a, b) => a.validFrom.localeCompare(b.validFrom));
        this.byCurrency.set(currency, list);
      }
      return row;
    }
    const list = this.byCurrency.get(currency) ?? [];
    let found: DemoRate | undefined;
    for (const r of list) {
      if (r.validFrom > date) break;
      found = r;
    }
    if (!found) throw new Error(`No recorded NBG ${currency} rate on or before ${date}`);
    return found;
  }

  /** `RateSource` for the app's `resolveRate`: answers from the fixture. */
  async getRates(date: string, currencies: readonly string[]) {
    return Promise.all(currencies.map((c) => this.rateOn(c, date)));
  }

  /** The domain rate of `currency` on `date`. */
  async fxRate(currency: string, date: string): Promise<FxRate & { text: string }> {
    const r = await this.rateOn(currency, date);
    return { rateScaled: parseRate(r.rate), quantity: r.quantity, currency, text: r.rate };
  }

  /** GEL equivalent of `amountMinor` at the NBG rate of `date`, unsigned. */
  async gelOn(currency: string, amountMinor: bigint, date: string): Promise<bigint> {
    const abs = amountMinor < 0n ? -amountMinor : amountMinor;
    if (currency === BASE_CURRENCY) return abs;
    return toGel(money(abs, currency), await this.fxRate(currency, date)).amountMinor;
  }
}
