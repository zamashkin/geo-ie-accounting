import type { Problem, ProblemCode } from '@geo-ie-accounting/contracts';

// The error type itself, with no runtime dependency on Zod or the contracts bundle, so the
// shell and forms can check errors without shipping every schema (bundle budget). Parsing
// responses into ApiError lives in ./errors.

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

/** Human message for an error, for toasts and form-level alerts. */
export function errorMessage(err: unknown): string {
  if (isApiError(err)) return err.problem.detail ?? err.problem.title;
  return 'Something went wrong. Try again.';
}
