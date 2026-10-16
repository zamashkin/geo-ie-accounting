import {
  AcceptInvitationResponse,
  InvitationPreview,
  type MagicLinkBody,
  SessionResponse,
  type SignInBody,
  type SignUpBody,
} from '@ie-ledger/contracts';
import { networkError } from '../api/api-error';
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
  me: '/v1/me',
  invitationPreview: '/v1/invitations/preview',
  acceptInvitation: '/v1/invitations/accept',
} as const;

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
    if (!response.ok) throw toApiError(response, body);
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
    await this.post(AUTH_PATHS.signUp, body);
  }

  async requestMagicLink(body: MagicLinkBody): Promise<void> {
    await this.post(AUTH_PATHS.magicLink, body);
  }

  async signOut(): Promise<void> {
    await this.post(AUTH_PATHS.signOut, {});
  }

  async getSession(): Promise<SessionResponse | null> {
    try {
      return SessionResponse.parse(await this.request(AUTH_PATHS.me));
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
