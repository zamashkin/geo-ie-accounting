import createClient, { type Middleware } from 'openapi-fetch';
import { publicEnv } from '../public-env';
import type { paths } from './schema.gen';

/**
 * Typed API client for client components. Cookie auth: the Better Auth session cookie is
 * sent with every request (`credentials: 'include'`), so the API must allow the web origin
 * with credentials (CORS) or sit behind the same origin.
 */
export function createBrowserApi(baseUrl: string = publicEnv().apiUrl) {
  const client = createClient<paths>({ baseUrl, credentials: 'include' });
  client.use(idempotencyMiddleware);
  return client;
}

export type BrowserApi = ReturnType<typeof createBrowserApi>;

let singleton: BrowserApi | undefined;

/** Shared instance for hooks and mutations. */
export function browserApi(): BrowserApi {
  singleton ??= createBrowserApi();
  return singleton;
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Every mutation carries an `Idempotency-Key` (ARCHITECTURE §7). Callers that retry the same
 * logical operation should pass their own key in the request headers; otherwise one is made
 * per request, which still protects against duplicate sends by the network stack.
 */
export const idempotencyMiddleware: Middleware = {
  onRequest({ request }) {
    if (MUTATING.has(request.method) && !request.headers.has('Idempotency-Key')) {
      request.headers.set('Idempotency-Key', crypto.randomUUID());
    }
    return request;
  },
};

/** Headers for a mutation that may be retried: reuse the key across retries. */
export function idempotencyHeaders(key: string): { 'Idempotency-Key': string } {
  return { 'Idempotency-Key': key };
}
