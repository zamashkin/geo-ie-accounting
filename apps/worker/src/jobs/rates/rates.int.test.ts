import { EVENTS_NOTIFY_CHANNEL, NotifyPayload } from '@ie-ledger/contracts';
import { getRateFor, listRates } from '@ie-ledger/db';
import { startTestDatabase, type TestDatabase } from '@ie-ledger/db/testing';
import { createNbgClient } from '@ie-ledger/nbg';
import { createFixtureFetch, type FixtureFetch } from '@ie-ledger/nbg/testing';
import { pino } from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startWorker, type RunningWorker } from '../../worker';
import { backfillRates } from './backfill';
import type { RatesDeps } from './deps';
import { publishEvent } from './events';
import { createRatesJobs } from './index';
import { resolveRate } from './resolve';
import { syncRates } from './sync';

// Real Postgres, real pg-boss, NBG answered from fixtures/nbg/ (no network).

const log = pino({ level: 'silent' });
let tdb: TestDatabase;
let nbgFetch: FixtureFetch;
let published: unknown[];
let deps: RatesDeps;
let nowValue: Date;

const CURRENCIES = ['EUR', 'GBP', 'USD'];
const OCT = { from: '2026-10-08', to: '2026-10-16', currencies: CURRENCIES };

beforeAll(async () => {
  tdb = await startTestDatabase();
});

afterAll(async () => {
  await (tdb as TestDatabase | undefined)?.close();
});

beforeEach(async () => {
  await tdb.pool.query('delete from exchange_rates');
  nbgFetch = createFixtureFetch();
  published = [];
  nowValue = new Date('2026-10-15T14:00:00Z');
  deps = {
    db: tdb.db,
    nbg: createNbgClient({ fetch: nbgFetch.fetch, retries: 0 }),
    currencies: CURRENCIES,
    publishBackfilled: (data) => {
      published.push(data);
      return Promise.resolve();
    },
    now: () => nowValue,
  };
});

async function allRates() {
  const { items } = await listRates(tdb.db, { limit: 1000 });
  return items.map((r) => `${r.validFrom} ${r.currency} ${r.rate}`);
}

describe('rates.backfill', () => {
  it('stores one row per rate start, and a second run adds nothing', async () => {
    const first = await backfillRates(deps, OCT, log);
    // 9 days requested; rates start on 8, 9, 10, 13, 14 and 16 Oct for 3 currencies.
    expect(first).toMatchObject({ days: 9, fetched: 9, inserted: 18, conflicts: [] });
    const rows = await allRates();
    expect(rows).toHaveLength(18);

    nbgFetch.calls.length = 0;
    const second = await backfillRates(deps, OCT, log);
    expect(second).toMatchObject({ inserted: 0, conflicts: [] });
    expect(await allRates()).toEqual(rows);
    // Days that start a stored rate are known; only 11, 12 and 15 Oct are asked again.
    expect(nbgFetch.calls.map((u) => u.searchParams.get('date'))).toEqual([
      '2026-10-11',
      '2026-10-12',
      '2026-10-15',
    ]);
  });

  it('resolves a Sunday receipt to the rate NBG set on Friday evening', async () => {
    await backfillRates(deps, OCT, log);
    const sunday = await getRateFor(tdb.db, 'USD', '2026-10-11');
    expect(sunday).toMatchObject({ validFrom: '2026-10-10', rate: '2.600500', quantity: 1 });
    // Friday 9 Oct 2026, 17:01 in Tbilisi.
    expect(sunday?.setAt?.toISOString()).toBe('2026-10-09T13:01:01.779Z');
    expect(await getRateFor(tdb.db, 'GBP', '2026-10-15')).toMatchObject({
      validFrom: '2026-10-14',
      rate: '3.441500',
    });
  });

  it('runs as a pg-boss job, twice, without duplicates, and broadcasts rates.backfilled', async () => {
    const listener = await tdb.pool.connect();
    const notifications: unknown[] = [];
    listener.on('notification', (n) => {
      if (n.channel === EVENTS_NOTIFY_CHANNEL && n.payload) {
        notifications.push(JSON.parse(n.payload));
      }
    });
    await listener.query(`listen ${EVENTS_NOTIFY_CHANNEL}`);

    let worker: RunningWorker | undefined;
    try {
      worker = await startWorker({
        connectionString: tdb.connectionString,
        log,
        jobs: createRatesJobs(() => ({
          ...deps,
          publishBackfilled: (data) => publishEvent(tdb.pool, { type: 'rates.backfilled', data }),
        })),
      });
      for (let run = 0; run < 2; run++) {
        const id = await worker.boss.send('rates.backfill', OCT);
        await waitForJob(worker, 'rates.backfill', id!);
      }
    } finally {
      await worker?.stop(5_000);
    }
    await waitFor(() => notifications.length >= 2);
    listener.release();

    expect(await allRates()).toHaveLength(18);
    const event = NotifyPayload.parse(notifications[0]);
    expect(event).toMatchObject({
      orgId: null,
      event: {
        type: 'rates.backfilled',
        data: { from: OCT.from, to: OCT.to, currencies: CURRENCIES },
      },
    });
  });

  it('fails the job on a currency NBG does not publish, storing nothing for it', async () => {
    await expect(
      backfillRates(deps, { from: '2026-10-14', to: '2026-10-14', currencies: ['XXX'] }, log),
    ).rejects.toThrow(/no rate for XXX/);
  });
});

describe('rates.sync', () => {
  it('starts from today when empty, then catches up through Easter to tomorrow', async () => {
    // Sunday 12 April 2026, 14:00 in Tbilisi: fetch today and tomorrow.
    nowValue = new Date('2026-04-12T10:00:00Z');
    const first = await syncRates(deps, ['USD'], log);
    expect(first).toMatchObject({ from: '2026-04-12', to: '2026-04-13', inserted: 1 });
    expect(await allRates()).toEqual(['2026-04-09 USD 2.696500']);

    // Tuesday 14 April, 18:00 in Tbilisi: the rate valid from Wednesday is out.
    nowValue = new Date('2026-04-14T14:00:00Z');
    const second = await syncRates(deps, ['USD'], log);
    expect(second).toMatchObject({ from: '2026-04-10', to: '2026-04-15', inserted: 1 });
    expect(await allRates()).toEqual(['2026-04-15 USD 2.696300', '2026-04-09 USD 2.696500']);
    expect(published).toEqual([
      { currencies: ['USD'], from: '2026-04-12', to: '2026-04-13' },
      { currencies: ['USD'], from: '2026-04-10', to: '2026-04-15' },
    ]);

    // Nothing new: no event.
    await syncRates(deps, ['USD'], log);
    expect(published).toHaveLength(2);
  });
});

describe('resolveRate', () => {
  it('trusts a row that starts on the date without asking NBG', async () => {
    await backfillRates(deps, { from: '2026-04-08', to: '2026-04-08', currencies: ['USD'] }, log);
    nbgFetch.calls.length = 0;
    const row = await resolveRate(deps, 'USD', '2026-04-08');
    expect(row).toMatchObject({ validFrom: '2026-04-08', rate: '2.697000' });
    expect(nbgFetch.calls).toHaveLength(0);
  });

  it('asks NBG when the newest row starts earlier, and stores the answer', async () => {
    await backfillRates(deps, { from: '2026-04-08', to: '2026-04-08', currencies: ['USD'] }, log);
    nbgFetch.calls.length = 0;
    // Only 8 April is stored; 14 April could be a gap or a holiday. NBG says: holiday period,
    // the rate valid from 9 April.
    const row = await resolveRate(deps, 'USD', '2026-04-14');
    expect(row).toMatchObject({ validFrom: '2026-04-09', rate: '2.696500' });
    expect(nbgFetch.calls.map((u) => u.searchParams.get('date'))).toEqual(['2026-04-14']);
  });
});

async function waitFor(check: () => boolean, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 50));
  }
}

async function waitForJob(worker: RunningWorker, name: string, id: string) {
  let state: string | undefined;
  for (let i = 0; i < 300; i++) {
    const [job] = await worker.boss.findJobs(name, { id });
    state = job?.state;
    if (state === 'completed') return;
    if (state === 'failed') throw new Error(`job ${id} failed`);
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`job ${id} did not complete (state ${state ?? 'unknown'})`);
}
