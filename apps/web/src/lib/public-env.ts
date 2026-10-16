import { z } from 'zod';

// Public (browser-visible) settings. Next inlines `process.env.NEXT_PUBLIC_*` at build time
// only for literal property reads, so each one is read explicitly below.

const PublicEnv = z.object({
  /** API base URL as the browser sees it. */
  apiUrl: z.url().default('http://localhost:4000'),
  /**
   * `api` (default): Better Auth in the API. `mock`: a local stand-in for the auth pages only,
   * for UI work without a running API (the org pages always need the API).
   */
  authMode: z.enum(['mock', 'api']).default('api'),
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
