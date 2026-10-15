import { describe, expect, it } from 'vitest';
import { jobs } from '../index';
import { loadRatesEnv } from './deps';
import { RATES_SYNC_SCHEDULES } from './index';

describe('rates jobs', () => {
  it('are registered with the worker', () => {
    const names = jobs.map((j) => j.name);
    expect(names).toContain('rates.sync');
    expect(names).toContain('rates.backfill');
  });

  it('sync at 17:30 and 20:00 (Tbilisi time zone set in scheduleRatesSync)', () => {
    expect(RATES_SYNC_SCHEDULES.map((s) => s.cron)).toEqual(['30 17 * * *', '0 20 * * *']);
  });
});

describe('loadRatesEnv', () => {
  it('defaults to USD, EUR and GBP', () => {
    expect(loadRatesEnv({}).RATES_CURRENCIES).toEqual(['USD', 'EUR', 'GBP']);
  });

  it('parses a configured list and rejects bad codes', () => {
    expect(loadRatesEnv({ RATES_CURRENCIES: 'USD, CHF' }).RATES_CURRENCIES).toEqual(['USD', 'CHF']);
    expect(() => loadRatesEnv({ RATES_CURRENCIES: 'usd' })).toThrow(/RATES_CURRENCIES/);
  });
});
