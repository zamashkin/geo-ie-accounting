import { z } from 'zod';

const booleanString = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

export const ApiEnv = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().default('0.0.0.0'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    DATABASE_URL: z
      .string()
      .regex(/^postgres(ql)?:\/\//, 'DATABASE_URL must be a postgres:// connection string'),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    LOG_PRETTY: booleanString.default(false),
    /** Origin of the web app, allowed by CORS with credentials. */
    WEB_ORIGIN: z.url().default('http://localhost:3000'),
    APP_VERSION: z.string().default('0.0.0-dev'),
    /** Public URL of this API; Better Auth builds magic-link and verification URLs from it. */
    API_PUBLIC_URL: z.url().default('http://localhost:4000'),
    /** Signs session cookies and tokens. Required (32+ chars) in production. */
    BETTER_AUTH_SECRET: z.string().min(32).optional(),
    /**
     * Parent domain for the session cookie when web and api are on sibling subdomains
     * (e.g. `example.ge` for app.example.ge + api.example.ge). Unset locally.
     */
    AUTH_COOKIE_DOMAIN: z.string().min(1).optional(),
    /** SMTP server for auth and invitation mail. Mailpit locally. */
    SMTP_URL: z
      .string()
      .regex(/^smtps?:\/\//)
      .default('smtp://localhost:1025'),
    MAIL_FROM: z.string().min(3).default('geo-ie-accounting <no-reply@geo-ie-accounting.local>'),
    /**
     * Public demo (ADR 0016): the sign-in page offers the read-only demo login made by
     * `pnpm db:seed:demo`. Off: read-only logins cannot sign in. Read-only logins can never
     * change anything, whatever this says.
     */
    DEMO_MODE: booleanString.default(false),
    /** `false` turns off sign-up (email+password and magic link), e.g. on a public demo. */
    DEMO_SIGNUP: booleanString.default(true),
  })
  .refine((env) => env.NODE_ENV !== 'production' || env.BETTER_AUTH_SECRET !== undefined, {
    path: ['BETTER_AUTH_SECRET'],
    message: 'BETTER_AUTH_SECRET is required in production',
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
