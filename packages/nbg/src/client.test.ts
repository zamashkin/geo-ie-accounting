import { describe, expect, it } from 'vitest';
import { createNbgClient, NBG_RATES_ENDPOINT, nbgRatesUrl, type NbgClientOptions } from './client';
import {
  NbgHttpError,
  NbgMissingCurrencyError,
  NbgNetworkError,
  NbgResponseError,
  NbgTimeoutError,
} from './errors';
import { createFixtureFetch, readNbgFixture } from './testing';

const usdBody = () => JSON.stringify(readNbgFixture('USD_2026-04-08.json'));
const ok = (body: string) => new Response(body, { status: 200 });

/** A fetch that answers from a script of responses or errors, one per call. */
function scripted(steps: (Response | Error | 'hang')[]) {
  const calls: URL[] = [];
  const fetch: typeof globalThis.fetch = (input, init) => {
    calls.push(new URL(input instanceof Request ? input.url : String(input)));
    const step = steps[calls.length - 1];
    if (step === undefined) return Promise.reject(new Error('unexpected extra call'));
    if (step === 'hang') {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(init.signal?.reason as Error);
        });
      });
    }
    return step instanceof Error ? Promise.reject(step) : Promise.resolve(step);
  };
  return { fetch, calls };
}

function client(fetch: typeof globalThis.fetch, extra: NbgClientOptions = {}) {
  const sleeps: number[] = [];
  const c = createNbgClient({
    fetch,
    sleep: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
    random: () => 0.5,
    ...extra,
  });
  return { c, sleeps };
}

describe('nbgRatesUrl', () => {
  it('repeats currencies= sorted and deduplicated, with the date', () => {
    const url = nbgRatesUrl('2026-10-14', ['USD', 'EUR', 'USD', 'GBP']);
    expect(url.toString()).toBe(
      `${NBG_RATES_ENDPOINT}?currencies=EUR&currencies=GBP&currencies=USD&date=2026-10-14`,
    );
  });
});

describe('createNbgClient', () => {
  it('returns rates for a multi-currency request from the recorded fixture', async () => {
    const f = createFixtureFetch();
    const { c } = client(f.fetch);
    const rates = await c.getRates('2026-10-11', ['USD', 'GBP', 'EUR']);
    expect(rates.map((r) => [r.currency, r.validFrom, r.rate])).toEqual([
      ['EUR', '2026-10-10', '2.9154'],
      ['GBP', '2026-10-10', '3.4415'],
      ['USD', '2026-10-10', '2.6005'],
    ]);
    expect(f.calls).toHaveLength(1);
  });

  it('throws NbgMissingCurrencyError when NBG has no rate for a code', async () => {
    const { c } = client(createFixtureFetch().fetch);
    const err = await c.getRates('2026-10-14', ['XXX']).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NbgMissingCurrencyError);
    expect((err as NbgMissingCurrencyError).missing).toEqual(['XXX']);
  });

  it('retries 5xx and network errors with growing backoff, then succeeds', async () => {
    const s = scripted([
      new Response('down', { status: 503 }),
      new TypeError('fetch failed'),
      ok(usdBody()),
    ]);
    const { c, sleeps } = client(s.fetch, { backoffBaseMs: 100 });
    const rates = await c.getRates('2026-04-08', ['USD']);
    expect(rates[0]!.rate).toBe('2.6970');
    expect(s.calls).toHaveLength(3);
    // full jitter at random() = 0.5: half of 100, then half of 200
    expect(sleeps).toEqual([50, 100]);
  });

  it('caps a single backoff delay', async () => {
    const s = scripted([new Response('', { status: 502 }), ok(usdBody())]);
    const { c, sleeps } = client(s.fetch, { backoffBaseMs: 10_000, backoffMaxMs: 1_000 });
    await c.getRates('2026-04-08', ['USD']);
    expect(sleeps).toEqual([500]);
  });

  it('gives up after the configured retries', async () => {
    const s = scripted([0, 1, 2].map(() => new Response('', { status: 500 })));
    const { c } = client(s.fetch, { retries: 2 });
    await expect(c.getRates('2026-04-08', ['USD'])).rejects.toBeInstanceOf(NbgHttpError);
    expect(s.calls).toHaveLength(3);
  });

  it('does not retry a 4xx', async () => {
    const s = scripted([new Response('', { status: 404 })]);
    const { c } = client(s.fetch);
    const err = await c.getRates('2026-04-08', ['USD']).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NbgHttpError);
    expect((err as NbgHttpError).status).toBe(404);
    expect(s.calls).toHaveLength(1);
  });

  it('retries 429', async () => {
    const s = scripted([new Response('', { status: 429 }), ok(usdBody())]);
    const { c } = client(s.fetch);
    await c.getRates('2026-04-08', ['USD']);
    expect(s.calls).toHaveLength(2);
  });

  it('does not retry a body it cannot parse', async () => {
    const s = scripted([ok('<html>maintenance</html>')]);
    const { c } = client(s.fetch);
    await expect(c.getRates('2026-04-08', ['USD'])).rejects.toBeInstanceOf(NbgResponseError);
    expect(s.calls).toHaveLength(1);
  });

  it('times out a hanging request and retries it', async () => {
    const s = scripted(['hang', ok(usdBody())]);
    const { c } = client(s.fetch, { timeoutMs: 20 });
    await expect(c.getRates('2026-04-08', ['USD'])).resolves.toHaveLength(1);
    expect(s.calls).toHaveLength(2);
  });

  it('reports a timeout when every attempt hangs', async () => {
    const s = scripted(['hang', 'hang']);
    const { c } = client(s.fetch, { timeoutMs: 10, retries: 1 });
    await expect(c.getRates('2026-04-08', ['USD'])).rejects.toBeInstanceOf(NbgTimeoutError);
  });

  it('wraps network failures', async () => {
    const s = scripted([new TypeError('getaddrinfo ENOTFOUND')]);
    const { c } = client(s.fetch, { retries: 0 });
    await expect(c.getRates('2026-04-08', ['USD'])).rejects.toBeInstanceOf(NbgNetworkError);
  });

  it('validates its inputs before calling NBG', async () => {
    const s = scripted([]);
    const { c } = client(s.fetch);
    await expect(c.getRates('2026-4-8', ['USD'])).rejects.toThrow();
    await expect(c.getRates('2026-04-08', ['usd'])).rejects.toThrow();
    await expect(c.getRates('2026-04-08', [])).rejects.toThrow(RangeError);
    expect(s.calls).toHaveLength(0);
  });
});
