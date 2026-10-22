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

/** `POST /v1/auth/request-password-reset`. The answer is the same whether the email exists. */
export const ForgotPasswordBody = z
  .object({ email: z.email('Enter a valid email address') })
  .meta({ id: 'ForgotPasswordBody' });
export type ForgotPasswordBody = z.output<typeof ForgotPasswordBody>;

const passwordsMatch = (b: { newPassword: string; confirmPassword: string }) =>
  b.newPassword === b.confirmPassword;
const MISMATCH = { message: 'The passwords do not match', path: ['confirmPassword'] };

/** The reset-password form (the token comes from the link, not from this form). */
export const ResetPasswordForm = z
  .object({ newPassword: Password, confirmPassword: z.string() })
  .refine(passwordsMatch, MISMATCH);
export type ResetPasswordForm = z.output<typeof ResetPasswordForm>;

/** `POST /v1/auth/change-password`: the current password is required; other sessions end. */
export const ChangePasswordForm = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password'),
    newPassword: Password,
    confirmPassword: z.string(),
  })
  .refine(passwordsMatch, MISMATCH);
export type ChangePasswordForm = z.output<typeof ChangePasswordForm>;

/** `POST /v1/auth/update-user`: only the display name is editable. */
export const UpdateNameBody = z
  .object({ name: z.string().trim().min(1, 'Enter your name').max(200) })
  .meta({ id: 'UpdateNameBody' });
export type UpdateNameBody = z.output<typeof UpdateNameBody>;

/**
 * `POST /v1/auth/change-email`: a confirmation goes to the current address first, then a
 * verification link to the new one. The email changes when that second link is opened.
 */
export const ChangeEmailBody = z
  .object({ newEmail: z.email('Enter a valid email address').max(254) })
  .meta({ id: 'ChangeEmailBody' });
export type ChangeEmailBody = z.output<typeof ChangeEmailBody>;

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
