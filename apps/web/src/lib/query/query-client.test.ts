import { describe, expect, it, vi } from 'vitest';
import { networkError, toApiError } from '../api/errors';
import { makeQueryClient, shouldRetry } from './query-client';

describe('shouldRetry', () => {
  it('retries network and server errors up to twice', () => {
    expect(shouldRetry(0, networkError(new TypeError('x')))).toBe(true);
    expect(shouldRetry(1, toApiError(new Response(null, { status: 503 }), null))).toBe(true);
    expect(shouldRetry(2, networkError(new TypeError('x')))).toBe(false);
  });

  it('never retries client errors', () => {
    expect(shouldRetry(0, toApiError(new Response(null, { status: 404 }), null))).toBe(false);
    expect(shouldRetry(0, new Error('bug'))).toBe(false);
  });
});

describe('makeQueryClient', () => {
  it('reports a 401 from a query', async () => {
    const onUnauthenticated = vi.fn();
    const client = makeQueryClient({ onUnauthenticated });
    await client
      .query({
        queryKey: ['me'],
        queryFn: () => Promise.reject(toApiError(new Response(null, { status: 401 }), null)),
      })
      .catch(() => undefined);
    expect(onUnauthenticated).toHaveBeenCalledOnce();
  });
});
