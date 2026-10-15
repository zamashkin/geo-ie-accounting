import { z } from 'zod';

const booleanString = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

export const ApiEnv = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: z
    .string()
    .regex(/^postgres(ql)?:\/\//, 'DATABASE_URL must be a postgres:// connection string'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  LOG_PRETTY: booleanString.default(false),
  /** Origin of the web app, allowed by CORS with credentials. */
  WEB_ORIGIN: z.url().default('http://localhost:3000'),
  APP_VERSION: z.string().default('0.0.0-dev'),
});
export type ApiEnv = z.output<typeof ApiEnv>;

/** Validates the environment at boot and fails fast with every problem listed. */
export function loadEnv(env: NodeJS.ProcessEnv = process.env): ApiEnv {
  const result = ApiEnv.safeParse(env);
  if (!result.success) {
    throw new Error(`Invalid API environment:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
