import { z } from 'zod';

// Public (browser-visible) settings. Next inlines `process.env.NEXT_PUBLIC_*` at build time
// only for literal property reads, so each one is read explicitly below.

const PublicEnv = z.object({
  /** API base URL as the browser sees it. */
  apiUrl: z.url().default('http://localhost:4000'),
  /**
   * `mock`: auth pages and the session use a local mock (until WS-05's Better Auth is wired).
   * `api`: real calls to the API.
   */
  authMode: z.enum(['mock', 'api']).default('mock'),
});
export type PublicEnv = z.output<typeof PublicEnv>;

let cached: PublicEnv | undefined;

export function publicEnv(): PublicEnv {
  cached ??= PublicEnv.parse({
    apiUrl: process.env.NEXT_PUBLIC_API_URL || undefined,
    authMode: process.env.NEXT_PUBLIC_AUTH_MODE || undefined,
  });
  return cached;
}
