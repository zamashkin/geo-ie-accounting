import {
  AcceptInvitationResponse,
  InvitationPreview,
  type MagicLinkBody,
  MeResponse,
  type SignInBody,
  type SignUpBody,
} from '@geo-ie-accounting/contracts';
import { ApiError, networkError } from '../api/api-error';
import { toApiError } from '../api/errors';
import type { AuthClient } from './types';

/**
 * Auth against the API (WS-05). Better Auth is mounted at `/v1/auth/*` on the API origin
 * (its errors are `{ code, message }`, which `toApiError` maps); the session and invitations
 * are regular `/v1` routes answering problem+json. All calls send the session cookie.
 */
export const AUTH_PATHS = {
  signIn: '/v1/auth/sign-in/email',
  signUp: '/v1/auth/sign-up/email',
  magicLink: '/v1/auth/sign-in/magic-link',
  signOut: '/v1/auth/sign-out',
  requestPasswordReset: '/v1/auth/request-password-reset',
  resetPassword: '/v1/auth/reset-password',
  changePassword: '/v1/auth/change-password',
  updateUser: '/v1/auth/update-user',
  changeEmail: '/v1/auth/change-email',
  me: '/v1/me',
  invitationPreview: '/v1/invitations/preview',
  acceptInvitation: '/v1/invitations/accept',
} as const;

/**
 * Better Auth resolves a relative `callbackURL` against the API origin, so the link in the
 * email would land on the API. Make it absolute on the web origin (checked by the API against
 * `WEB_ORIGIN`).
 */
export function withAbsoluteCallback<T extends { callbackURL?: string | undefined }>(
  body: T,
  origin: string | undefined = typeof window === 'undefined' ? undefined : window.location.origin,
): T {
  const { callbackURL } = body;
  if (!callbackURL || !origin || !callbackURL.startsWith('/')) return body;
  return { ...body, callbackURL: new URL(callbackURL, origin).toString() };
}

/** Better Auth error codes (`{ code, message }`) worth a clearer message than its own. */
export const AUTH_ERROR_TEXT: Record<string, string> = {
  INVALID_TOKEN: 'This reset link is invalid or has expired. Ask for a new one.',
  INVALID_PASSWORD: 'Your current password is not right.',
  CREDENTIAL_ACCOUNT_NOT_FOUND:
    'Your account has no password yet (you sign in by email link). Use “Forgot password” on the sign-in page to set one.',
  PASSWORD_TOO_SHORT: 'Use at least 12 characters.',
  PASSWORD_TOO_LONG: 'Use at most 128 characters.',
  SESSION_EXPIRED: 'Your session has expired. Sign in again.',
};

/** An error from a Better Auth endpoint, with its own code (`INVALID_TOKEN`, ...). */
export class AuthApiError extends ApiError {
  constructor(
    base: ApiError,
    readonly authCode: string,
  ) {
    super({ ...base.problem, detail: AUTH_ERROR_TEXT[authCode] ?? base.problem.detail }, base.kind);
  }
}

function withAuthCode(err: ApiError, body: unknown): ApiError {
  const code =
    typeof body === 'object' && body !== null && 'code' in body && typeof body.code === 'string'
      ? body.code
      : null;
  return code ? new AuthApiError(err, code) : err;
}

/** Better Auth's error code, if the error came from one of its endpoints. */
export function authErrorCode(err: unknown): string | null {
  return err instanceof AuthApiError ? err.authCode : null;
}

export class HttpAuthClient implements AuthClient {
  constructor(
    private readonly apiUrl: string,
    private readonly fetchImpl: typeof fetch = (...args) => fetch(...args),
  ) {}

  private async request(path: string, init: RequestInit = {}): Promise<unknown> {
    const headers = new Headers(init.headers);
    headers.set('accept', 'application/json');
    if (init.body) headers.set('content-type', 'application/json');
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.apiUrl}${path}`, {
        ...init,
        credentials: 'include',
        headers,
      });
    } catch (err) {
      throw networkError(err);
    }
    const text = await response.text();
    let body: unknown = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }
    if (!response.ok) throw withAuthCode(toApiError(response, body), body);
    return body;
  }

  private post(path: string, body: unknown, headers?: Record<string, string>) {
    return this.request(path, {
      method: 'POST',
      body: JSON.stringify(body),
      ...(headers ? { headers } : {}),
    });
  }

  async signIn(body: SignInBody): Promise<void> {
    await this.post(AUTH_PATHS.signIn, body);
  }

  async signUp(body: SignUpBody): Promise<void> {
    await this.post(AUTH_PATHS.signUp, withAbsoluteCallback(body));
  }

  async requestMagicLink(body: MagicLinkBody): Promise<void> {
    await this.post(AUTH_PATHS.magicLink, withAbsoluteCallback(body));
  }

  async signOut(): Promise<void> {
    await this.post(AUTH_PATHS.signOut, {});
  }

  async requestPasswordReset(email: string, next?: string): Promise<void> {
    const path = next ? `/reset-password?next=${encodeURIComponent(next)}` : '/reset-password';
    // Better Auth calls it `redirectTo` here; the API puts it on the web origin either way.
    const { callbackURL } = withAbsoluteCallback({ callbackURL: path });
    await this.post(AUTH_PATHS.requestPasswordReset, { email, redirectTo: callbackURL });
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    await this.post(AUTH_PATHS.resetPassword, { token, newPassword });
  }

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    await this.post(AUTH_PATHS.changePassword, {
      currentPassword,
      newPassword,
      revokeOtherSessions: true,
    });
  }

  async updateName(name: string): Promise<void> {
    await this.post(AUTH_PATHS.updateUser, { name });
  }

  async changeEmail(newEmail: string, callbackPath: string): Promise<void> {
    await this.post(
      AUTH_PATHS.changeEmail,
      withAbsoluteCallback({ newEmail, callbackURL: callbackPath }),
    );
  }

  async getSession(): Promise<MeResponse | null> {
    try {
      return MeResponse.parse(await this.request(AUTH_PATHS.me));
    } catch (err) {
      if (err instanceof Error && 'status' in err && (err as { status: number }).status === 401)
        return null;
      throw err;
    }
  }

  async getInvitation(token: string): Promise<InvitationPreview> {
    return InvitationPreview.parse(await this.post(AUTH_PATHS.invitationPreview, { token }));
  }

  async acceptInvitation(token: string): Promise<AcceptInvitationResponse> {
    return AcceptInvitationResponse.parse(
      await this.post(
        AUTH_PATHS.acceptInvitation,
        { token },
        { 'Idempotency-Key': `accept-${token}` },
      ),
    );
  }
}
