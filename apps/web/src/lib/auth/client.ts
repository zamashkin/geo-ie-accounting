import { publicEnv } from '../public-env';
import { HttpAuthClient } from './http-client';
import { MockAuthClient } from './mock-client';
import type { AuthClient } from './types';

let instance: AuthClient | undefined;

/** The browser auth client: mock until WS-05 lands (`NEXT_PUBLIC_AUTH_MODE=api` switches). */
export function authClient(): AuthClient {
  if (!instance) {
    const env = publicEnv();
    instance = env.authMode === 'api' ? new HttpAuthClient(env.apiUrl) : new MockAuthClient();
  }
  return instance;
}

export { safeNextPath } from './next-path';
