import 'server-only';
import { serverEnv } from '@/env';
import type { HealthResult } from '@/lib/health';
import { createApiClient } from './client';

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
