import { Problem, PROBLEM_CODES, type ProblemCode } from '@ie-ledger/contracts';
import { ApiError, networkError } from './api-error';

export { ApiError, errorMessage, isApiError, networkError } from './api-error';

const STATUS_CODES: Partial<Record<number, ProblemCode>> = {
  400: 'bad_request',
  401: 'unauthenticated',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  413: 'payload_too_large',
  422: 'validation_failed',
  429: 'rate_limited',
  503: 'service_unavailable',
};

function codeForStatus(status: number): ProblemCode {
  return STATUS_CODES[status] ?? (status >= 500 ? 'internal_error' : 'bad_request');
}

/** Builds an ApiError from a non-2xx response and its parsed body (if any). */
export function toApiError(response: Response, body: unknown): ApiError {
  const parsed = Problem.safeParse(body);
  if (parsed.success) return new ApiError(parsed.data, 'problem');
  // Some errors (e.g. Better Auth's) are JSON with `code`/`message` but not full problems.
  const loose = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  const code =
    typeof loose['code'] === 'string' &&
    (PROBLEM_CODES as readonly string[]).includes(loose['code'])
      ? (loose['code'] as ProblemCode)
      : codeForStatus(response.status);
  const message = typeof loose['message'] === 'string' ? loose['message'] : undefined;
  return new ApiError(
    {
      type: 'about:blank',
      title: response.statusText || `HTTP ${response.status}`,
      status: response.status >= 400 && response.status <= 599 ? response.status : 500,
      code,
      requestId: response.headers.get('x-request-id') ?? 'unknown',
      ...(message ? { detail: message } : {}),
    },
    'unexpected',
  );
}

/**
 * Unwraps an openapi-fetch result: returns `data` or throws ApiError.
 * `const accounts = await unwrap(api.GET('/v1/orgs/{orgId}/accounts', { params }))`.
 */
export async function unwrap<T>(
  call: Promise<{ data?: T; error?: unknown; response: Response }>,
): Promise<T> {
  let result: { data?: T; error?: unknown; response: Response };
  try {
    result = await call;
  } catch (err) {
    throw networkError(err);
  }
  if (result.response.ok) return result.data as T;
  throw toApiError(result.response, result.error);
}
