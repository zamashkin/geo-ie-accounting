import 'server-only';
import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { serverEnv } from '@/env';
import type { HealthResult } from '@/lib/health';
import { isApiError } from './api-error';
import { createApiClient } from './client';
import { unwrap } from './errors';

const api = createApiClient(serverEnv().API_URL);

/** Server-side health check. Never throws: an unreachable API is a result, not an error. */
export async function getHealth(): Promise<HealthResult> {
  try {
    const { data, error, response } = await api.GET('/healthz', {
      cache: 'no-store',
      signal: AbortSignal.timeout(3_000),
    });
    if (data) return { kind: 'ok', body: data };
    if (response.status === 503 && 'checks' in error) {
      return { kind: 'degraded', body: error };
    }
    return { kind: 'unreachable', reason: `HTTP ${response.status}` };
  } catch (err) {
    return { kind: 'unreachable', reason: err instanceof Error ? err.message : 'request failed' };
  }
}

/**
 * Typed API client for server components, acting as the signed-in user: it forwards the
 * request's cookies (ADR 0011). Reads only. Mutations go through the browser client, where the
 * browser sets `Origin` for the API's CSRF check.
 */
export async function serverApi() {
  const cookieHeader = (await cookies()).toString();
  const client = createApiClient(serverEnv().API_URL, {
    fetch: (request: Request) => fetch(request, { cache: 'no-store' }),
  });
  client.use({
    onRequest({ request }) {
      request.headers.set('accept', 'application/json');
      if (cookieHeader) request.headers.set('cookie', cookieHeader);
      return request;
    },
  });
  return client;
}

/**
 * Unwraps a server-side read. A lost session goes to sign-in (back to `nextPath` afterwards),
 * a 404 renders the not-found page; anything else reaches the error boundary.
 */
export async function serverRead<T>(
  call: Promise<{ data?: T; error?: unknown; response: Response }>,
  nextPath: string,
): Promise<T> {
  try {
    return await unwrap(call);
  } catch (err) {
    if (isApiError(err) && err.status === 401) {
      redirect(`/sign-in?next=${encodeURIComponent(nextPath)}`);
    }
    if (isApiError(err) && err.status === 404) notFound();
    throw err;
  }
}
