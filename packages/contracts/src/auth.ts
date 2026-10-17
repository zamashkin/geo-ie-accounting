import { z } from 'zod';

// Request bodies for the Better Auth forms (WS-04). Session and invitation responses
// (/v1/me, /v1/invitations/*) live in tenancy.ts.

/** WS-05's password policy (12–128). */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

export const Password = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(PASSWORD_MAX_LENGTH, `Use at most ${PASSWORD_MAX_LENGTH} characters`);

export const SignInBody = z
  .object({
    email: z.email('Enter a valid email address'),
    password: z.string().min(1, 'Enter your password'),
    rememberMe: z.boolean().optional(),
  })
  .meta({ id: 'SignInBody' });
export type SignInBody = z.output<typeof SignInBody>;

export const SignUpBody = z
  .object({
    name: z.string().trim().min(1, 'Enter your name').max(200),
    email: z.email('Enter a valid email address'),
    password: Password,
    /** Where the email-verification link lands. */
    callbackURL: z.string().startsWith('/').optional(),
  })
  .meta({ id: 'SignUpBody' });
export type SignUpBody = z.output<typeof SignUpBody>;

export const MagicLinkBody = z
  .object({
    email: z.email('Enter a valid email address'),
    name: z.string().optional(),
    /** Where the link lands after verification (a path on the web app). */
    callbackURL: z.string().startsWith('/').optional(),
  })
  .meta({ id: 'MagicLinkBody' });
export type MagicLinkBody = z.output<typeof MagicLinkBody>;

// ── Public settings ─────────────────────────────────────────────────────────────────────

/** The read-only demo login, shown on the sign-in page when the demo is on. */
export const DemoLogin = z
  .object({ email: z.email(), password: z.string() })
  .meta({ id: 'DemoLogin' });
export type DemoLogin = z.output<typeof DemoLogin>;

/** `GET /v1/public-config`: what the sign-in and sign-up pages need before anyone signs in. */
export const PublicConfig = z
  .object({
    /** Null unless the API runs with `DEMO_MODE=true`. */
    demo: DemoLogin.nullable(),
    /** False when the API runs with `DEMO_SIGNUP=false`. */
    signUpEnabled: z.boolean(),
  })
  .meta({ id: 'PublicConfig' });
export type PublicConfig = z.output<typeof PublicConfig>;
