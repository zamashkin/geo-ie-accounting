import 'server-only';
import { MeResponse } from '@ie-ledger/contracts';
import { cookies } from 'next/headers';
import { cache } from 'react';
import { serverEnv } from '@/env';
import { publicEnv } from '../public-env';
import { AUTH_PATHS } from './http-client';
import { decodeMockSession, demoSession, MOCK_SESSION_COOKIE } from './mock-data';

/**
 * The signed-in user for server components, once per request. Null when signed out.
 * Mock mode reads the mock cookie; API mode forwards the request's cookies to `GET /v1/me`.
 */
export const getSession = cache(async (): Promise<MeResponse | null> => {
  const jar = await cookies();
  if (publicEnv().authMode === 'mock') {
    const user = decodeMockSession(jar.get(MOCK_SESSION_COOKIE)?.value);
    return user ? demoSession(user) : null;
  }
  const response = await fetch(`${serverEnv().API_URL}${AUTH_PATHS.me}`, {
    headers: { cookie: jar.toString(), accept: 'application/json' },
    cache: 'no-store',
    signal: AbortSignal.timeout(3_000),
  });
  if (response.status === 401) return null;
  if (!response.ok) throw new Error(`GET ${AUTH_PATHS.me} failed: HTTP ${response.status}`);
  return MeResponse.parse(await response.json());
});
