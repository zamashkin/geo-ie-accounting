import { Problem, PROBLEM_CODES, type ProblemCode } from '@ie-ledger/contracts';

/**
 * Every failed API call surfaces as an ApiError carrying an RFC 9457 problem (ARCHITECTURE §7).
 * Non-problem responses (a proxy's HTML 502, a network failure) are mapped to a synthetic
 * problem so callers handle one shape.
 */
export class ApiError extends Error {
  override readonly name = 'ApiError';
  readonly problem: Problem;
  /** `network`: no response at all. `problem`: the API answered with problem+json. */
  readonly kind: 'problem' | 'network' | 'unexpected';

  constructor(problem: Problem, kind: ApiError['kind'], options?: { cause?: unknown }) {
    super(problem.detail ?? problem.title, options);
    this.problem = problem;
    this.kind = kind;
  }

  get status(): number {
    return this.problem.status;
  }

  get code(): ProblemCode {
    return this.problem.code;
  }

  /** Field errors for `validation_failed`, keyed by path (`"email"`, `"lines.0.amount"`). */
  fieldErrors(): Record<string, string> {
    return Object.fromEntries((this.problem.errors ?? []).map((e) => [e.path, e.message]));
  }
}

export function isApiError(err: unknown): err is ApiError {
  return err instanceof ApiError;
}

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

/** For fetch rejections: offline, DNS, CORS, aborted. */
export function networkError(cause: unknown): ApiError {
  const aborted = cause instanceof DOMException && cause.name === 'AbortError';
  return new ApiError(
    {
      type: 'about:blank',
      title: aborted ? 'Request cancelled' : 'Network error',
      status: 503,
      code: 'service_unavailable',
      requestId: 'none',
      detail: aborted
        ? 'The request was cancelled.'
        : 'Could not reach the server. Check your connection and try again.',
    },
    'network',
    { cause },
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

/** Human message for an error, for toasts and form-level alerts. */
export function errorMessage(err: unknown): string {
  if (isApiError(err)) return err.problem.detail ?? err.problem.title;
  return 'Something went wrong. Try again.';
}
