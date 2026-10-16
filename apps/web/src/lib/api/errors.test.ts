import { describe, expect, it } from 'vitest';
import { ApiError, errorMessage, networkError, toApiError, unwrap } from './errors';

const problem = {
  type: 'https://ie-ledger.dev/problems/validation',
  title: 'Validation failed',
  status: 422,
  code: 'validation_failed',
  requestId: 'req-1',
  detail: 'Check the highlighted fields.',
  errors: [{ path: 'email', message: 'Already registered' }],
};

function response(status: number, headers: Record<string, string> = {}): Response {
  return new Response(null, { status, headers });
}

describe('toApiError', () => {
  it('keeps a problem+json body as is', () => {
    const err = toApiError(response(422), problem);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.kind).toBe('problem');
    expect(err.code).toBe('validation_failed');
    expect(err.fieldErrors()).toEqual({ email: 'Already registered' });
    expect(err.message).toBe('Check the highlighted fields.');
  });

  it('maps a non-problem response by status and keeps the request id', () => {
    const err = toApiError(response(403, { 'x-request-id': 'abc' }), '<html>');
    expect(err.kind).toBe('unexpected');
    expect(err.code).toBe('forbidden');
    expect(err.problem.requestId).toBe('abc');
  });

  it('uses a known code and message from a loose JSON error', () => {
    const err = toApiError(response(401), { code: 'unauthenticated', message: 'Session expired' });
    expect(err.code).toBe('unauthenticated');
    expect(errorMessage(err)).toBe('Session expired');
  });

  it('treats unknown 5xx as internal_error', () => {
    expect(toApiError(response(502), null).code).toBe('internal_error');
  });
});

describe('unwrap', () => {
  it('returns data on success', async () => {
    await expect(
      unwrap(Promise.resolve({ data: { ok: 1 }, response: response(200) })),
    ).resolves.toEqual({
      ok: 1,
    });
  });

  it('throws ApiError on an error response', async () => {
    await expect(
      unwrap(Promise.resolve({ error: problem, response: response(422) })),
    ).rejects.toMatchObject({ code: 'validation_failed', status: 422 });
  });

  it('turns a rejected fetch into a network error', async () => {
    await expect(unwrap(Promise.reject(new TypeError('fetch failed')))).rejects.toMatchObject({
      kind: 'network',
      code: 'service_unavailable',
    });
  });
});

describe('networkError', () => {
  it('recognises aborts', () => {
    expect(networkError(new DOMException('x', 'AbortError')).problem.title).toBe(
      'Request cancelled',
    );
  });
});

describe('errorMessage', () => {
  it('falls back for unknown errors', () => {
    expect(errorMessage(new Error('boom'))).toBe('Something went wrong. Try again.');
  });
});
