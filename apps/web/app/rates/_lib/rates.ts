import 'server-only';
import { ListRatesQuery } from '@ie-ledger/contracts';
import { serverEnv } from '@/env';
import { createApiClient } from '@/lib/api/client';
import type { components } from '@/lib/api/schema.gen';

export type ExchangeRateDto = components['schemas']['ExchangeRate'];

/** Currencies offered in the picker. SPEC §3 M1 syncs these by default. */
export const PICKER_CURRENCIES = ['USD', 'EUR', 'GBP'] as const;

const DAY_MS = 86_400_000;
const tbilisiDay = (d: Date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tbilisi' }).format(d);

export interface RatesFilter {
  currency: string | undefined;
  from: string;
  to: string;
  cursor: string | undefined;
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

/** Reads the URL search params; defaults to the last 30 days in Tbilisi. */
export function readFilter(
  params: Record<string, string | string[] | undefined>,
  now = new Date(),
): { filter: RatesFilter; error: string | null } {
  const raw = {
    currency: first(params.currency),
    from: first(params.from) ?? tbilisiDay(new Date(now.getTime() - 30 * DAY_MS)),
    to: first(params.to) ?? tbilisiDay(now),
    cursor: first(params.cursor),
  };
  const parsed = ListRatesQuery.safeParse(raw);
  if (!parsed.success) {
    return {
      filter: { ...raw, currency: undefined, cursor: undefined },
      error: parsed.error.issues.map((i) => i.message).join('; '),
    };
  }
  return { filter: raw, error: null };
}

export type RatesPage =
  | { kind: 'ok'; items: ExchangeRateDto[]; nextCursor: string | null }
  | { kind: 'error'; reason: string };

export async function fetchRates(filter: RatesFilter): Promise<RatesPage> {
  const api = createApiClient(serverEnv().API_URL);
  try {
    const { data, error, response } = await api.GET('/v1/rates', {
      params: {
        query: {
          limit: 100,
          from: filter.from,
          to: filter.to,
          ...(filter.currency ? { currency: filter.currency } : {}),
          ...(filter.cursor ? { cursor: filter.cursor } : {}),
        },
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(5_000),
    });
    if (data) return { kind: 'ok', items: data.items, nextCursor: data.nextCursor };
    return { kind: 'error', reason: error.detail ?? `HTTP ${response.status}` };
  } catch (err) {
    return { kind: 'error', reason: err instanceof Error ? err.message : 'request failed' };
  }
}

/** `"2.598900"` → `"2.5989"`: drops storage padding, keeps NBG's four decimals. String-only. */
export function displayRate(rate: string): string {
  const [int = '0', frac = ''] = rate.split('.');
  const trimmed = frac.replace(/0+$/, '').padEnd(4, '0');
  return `${int}.${trimmed}`;
}

const setAtFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Tbilisi',
  dateStyle: 'medium',
  timeStyle: 'short',
});

/** When NBG set the rate, in Tbilisi time. */
export function displaySetAt(setAt: string | null): string {
  return setAt ? setAtFormat.format(new Date(setAt)) : '—';
}
