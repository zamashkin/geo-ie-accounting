import { startTestDatabase, type TestDatabase } from '@ie-ledger/db/testing';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defineJob } from './jobs/define';
import { startWorker, type RunningWorker } from './worker';

let tdb: TestDatabase | undefined;
let worker: RunningWorker | undefined;
const handled: (string | null)[] = [];
let resolveHandled: (() => void) | undefined;

const testNoop = defineJob({
  name: 'noop',
  queue: { retryLimit: 0 },
  handler: async (payload) => {
    handled.push(payload.message ?? null);
    resolveHandled?.();
  },
});

beforeAll(async () => {
  tdb = await startTestDatabase();
  worker = await startWorker({
    connectionString: tdb.connectionString,
    log: pino({ level: 'silent' }),
    jobs: [testNoop],
  });
});

afterAll(async () => {
  await worker?.stop(5_000);
  await tdb?.close();
});

async function waitForState(id: string, state: string) {
  for (let i = 0; i < 100; i++) {
    const [job] = await worker!.boss.findJobs('noop', { id });
    if (job?.state === state) return job;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`job ${id} never reached ${state}`);
}

describe('worker', () => {
  it('runs a noop job end to end', async () => {
    const done = new Promise<void>((r) => (resolveHandled = r));
    const id = await worker!.boss.send('noop', { message: 'hello' });
    await done;
    expect(handled).toContain('hello');
    await waitForState(id!, 'completed');
  });

  it('fails a job whose payload does not match the contract', async () => {
    const before = handled.length;
    const id = await worker!.boss.send('noop', { message: 42 });
    await waitForState(id!, 'failed');
    expect(handled.length).toBe(before);
  });
});
