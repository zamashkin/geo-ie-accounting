import { z } from 'zod';

export const DbEnv = z.object({
  DATABASE_URL: z
    .string()
    .regex(/^postgres(ql)?:\/\//, 'DATABASE_URL must be a postgres:// connection string'),
});
export type DbEnv = z.output<typeof DbEnv>;

/** Validates the environment and fails fast with a readable message. */
export function loadDbEnv(env: NodeJS.ProcessEnv = process.env): DbEnv {
  const result = DbEnv.safeParse(env);
  if (!result.success) {
    throw new Error(`Invalid database environment:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
