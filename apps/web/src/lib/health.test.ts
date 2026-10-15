import { describe, expect, it } from 'vitest';
import { serverEnv } from '../env';
import { describeHealth } from './health';

const body = {
  status: 'ok' as const,
  version: '0.1.0',
  time: '2026-10-15T10:00:00.000Z',
  checks: { database: 'ok' as const },
};

describe('describeHealth', () => {
  it('shows a healthy API', () => {
    expect(describeHealth({ kind: 'ok', body })).toMatchObject({ tone: 'ok', label: 'Healthy' });
  });

  it('shows a degraded API with the failing check', () => {
    const view = describeHealth({
      kind: 'degraded',
      body: { ...body, status: 'degraded', checks: { database: 'fail' } },
    });
    expect(view).toMatchObject({ tone: 'warn', detail: 'Database check: fail' });
  });

  it('shows an unreachable API', () => {
    expect(describeHealth({ kind: 'unreachable', reason: 'fetch failed' })).toMatchObject({
      tone: 'down',
      detail: 'fetch failed',
    });
  });
});

describe('serverEnv', () => {
  it('defaults API_URL to the local API', () => {
    expect(serverEnv({}).API_URL).toBe('http://localhost:4000');
  });

  it('rejects a malformed API_URL', () => {
    expect(() => serverEnv({ API_URL: 'not a url' })).toThrow(/API_URL/);
  });
});
