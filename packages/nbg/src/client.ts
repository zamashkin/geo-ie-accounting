import { CurrencyCode, IsoDate } from '@ie-ledger/contracts';
import {
  NbgError,
  NbgHttpError,
  NbgMissingCurrencyError,
  NbgNetworkError,
  NbgResponseError,
  NbgTimeoutError,
} from './errors';
import { parseNbgResponse, type NbgRate } from './parse';

/** Rates endpoint checked on 2026-10-15. Query: `?currencies=USD&currencies=EUR&date=YYYY-MM-DD`. */
export const NBG_RATES_ENDPOINT =
  'https://nbg.gov.ge/gw/api/ct/monetarypolicy/currencies/en/json/' as const;

export interface NbgClientOptions {
  /** Injected in tests; defaults to the global `fetch`. */
  fetch?: typeof globalThis.fetch;
  endpoint?: string;
  /** Per attempt. Default 10 s. */
  timeoutMs?: number;
  /** Retries after the first attempt, for retryable errors only. Default 3. */
  retries?: number;
  /** First backoff delay; doubles per retry, with full jitter. Default 500 ms. */
  backoffBaseMs?: number;
  /** Cap on a single backoff delay. Default 8 s. */
  backoffMaxMs?: number;
  /** Injected in tests to skip real waiting. */
  sleep?: (ms: number) => Promise<void>;
  /** Injected in tests to make jitter deterministic. Returns [0, 1). */
  random?: () => number;
}

export interface NbgClient {
  /**
   * Rates valid on `date` for `currencies` (SPEC §2.3): for a weekend or holiday NBG returns the
   * last rate set, so `validFrom` may be earlier than `date`. Throws `NbgMissingCurrencyError`
   * when NBG has no rate for one of the codes.
   */
  getRates(date: IsoDate, currencies: readonly CurrencyCode[]): Promise<NbgRate[]>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Builds the request URL. Codes go sorted: NBG answers `[]` for some unsorted lists. */
export function nbgRatesUrl(
  date: IsoDate,
  currencies: readonly CurrencyCode[],
  endpoint: string = NBG_RATES_ENDPOINT,
): URL {
  const url = new URL(endpoint);
  for (const code of [...new Set(currencies)].sort()) url.searchParams.append('currencies', code);
  url.searchParams.set('date', date);
  return url;
}

export function createNbgClient(options: NbgClientOptions = {}): NbgClient {
  const {
    fetch: doFetch = globalThis.fetch,
    endpoint = NBG_RATES_ENDPOINT,
    timeoutMs = 10_000,
    retries = 3,
    backoffBaseMs = 500,
    backoffMaxMs = 8_000,
    sleep = defaultSleep,
    random = Math.random,
  } = options;

  async function attempt(url: URL): Promise<unknown> {
    let res: Response;
    try {
      res = await doFetch(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'TimeoutError') {
        throw new NbgTimeoutError(timeoutMs);
      }
      throw new NbgNetworkError(err);
    }
    if (!res.ok) {
      await res.body?.cancel();
      throw new NbgHttpError(res.status);
    }
    try {
      return await res.json();
    } catch (err) {
      if (err instanceof DOMException && err.name === 'TimeoutError') {
        throw new NbgTimeoutError(timeoutMs);
      }
      throw new NbgResponseError('body is not JSON', err);
    }
  }

  async function withRetries(url: URL): Promise<unknown> {
    for (let i = 0; ; i++) {
      try {
        return await attempt(url);
      } catch (err) {
        if (!(err instanceof NbgError) || !err.retryable || i >= retries) throw err;
        const ceiling = Math.min(backoffMaxMs, backoffBaseMs * 2 ** i);
        await sleep(Math.floor(random() * ceiling));
      }
    }
  }

  return {
    async getRates(date, currencies) {
      const requested = currencies.map((c) => CurrencyCode.parse(c));
      if (requested.length === 0) throw new RangeError('At least one currency is required');
      const url = nbgRatesUrl(IsoDate.parse(date), requested, endpoint);
      const rates = parseNbgResponse(await withRetries(url), date);
      const found = new Set(rates.map((r) => r.currency));
      const missing = [...new Set(requested)].filter((c) => !found.has(c));
      if (missing.length > 0) throw new NbgMissingCurrencyError(date, missing);
      return rates.filter((r) => requested.includes(r.currency));
    },
  };
}
