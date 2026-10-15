import { JOB_NAMES } from '@ie-ledger/contracts';
import { describe, expect, it } from 'vitest';
import { deadLetterQueue, DEFAULT_QUEUE_OPTIONS } from './define';
import { jobs } from './index';

describe('job registry', () => {
  it('registers only job names defined in contracts, once each', () => {
    const names = jobs.map((j) => j.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(JOB_NAMES).toContain(name);
  });

  it('registers the noop job', () => {
    expect(jobs.map((j) => j.name)).toContain('noop');
  });

  it('retries with backoff and dead-letters', () => {
    expect(DEFAULT_QUEUE_OPTIONS.retryBackoff).toBe(true);
    expect(deadLetterQueue('import.commit')).toBe('import.commit.dead');
  });
});
