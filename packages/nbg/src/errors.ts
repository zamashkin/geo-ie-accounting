/** Base class for everything the NBG client throws. `retryable` drives the client's own retries. */
export class NbgError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** Non-2xx answer. 5xx and 429 are retried, other statuses are not. */
export class NbgHttpError extends NbgError {
  constructor(readonly status: number) {
    super(`NBG answered HTTP ${status}`, status >= 500 || status === 429);
  }
}

/** The request did not finish within the timeout. Retried. */
export class NbgTimeoutError extends NbgError {
  constructor(readonly timeoutMs: number) {
    super(`NBG did not answer within ${timeoutMs} ms`, true);
  }
}

/** DNS, TCP or TLS failure. Retried. */
export class NbgNetworkError extends NbgError {
  constructor(cause: unknown) {
    super('Could not reach NBG', true, { cause });
  }
}

/** The body is not the shape SPEC §2.3 describes. Not retried: NBG changed its format. */
export class NbgResponseError extends NbgError {
  constructor(message: string, cause?: unknown) {
    super(`Unexpected NBG response: ${message}`, false, { cause });
  }
}

/** NBG answered, but without some of the requested currencies (unknown code, or no rate yet). */
export class NbgMissingCurrencyError extends NbgError {
  constructor(
    readonly date: string,
    readonly missing: readonly string[],
  ) {
    super(`NBG has no rate for ${missing.join(', ')} on ${date}`, false);
  }
}
