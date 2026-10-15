import { z } from 'zod';

const ServerEnv = z.object({
  /** API base URL used by server components. */
  API_URL: z.url().default('http://localhost:4000'),
});
export type ServerEnv = z.output<typeof ServerEnv>;

let cached: ServerEnv | undefined;

/** Validated server-side environment. Fails fast with every problem listed. */
export function serverEnv(env: Record<string, string | undefined> = process.env): ServerEnv {
  if (cached && env === process.env) return cached;
  const result = ServerEnv.safeParse(env);
  if (!result.success) {
    throw new Error(`Invalid web environment:\n${z.prettifyError(result.error)}`);
  }
  if (env === process.env) cached = result.data;
  return result.data;
}
