import {
  AcceptInvitationResponse,
  InvitationPreview,
  type MagicLinkBody,
  SessionResponse,
  type SignInBody,
  type SignUpBody,
} from '@ie-ledger/contracts';
import { networkError, toApiError } from '../api/errors';
import type { AuthClient } from './types';

/**
 * Auth against the API (WS-05). Better Auth is mounted at `/api/auth/*` on the API origin;
 * session and invitation reads are regular `/v1` routes. These paths are the integration
 * contract listed in the WS-04 report; adjust here if WS-05 mounts them elsewhere.
 */
export const AUTH_PATHS = {
  signIn: '/api/auth/sign-in/email',
  signUp: '/api/auth/sign-up/email',
  magicLink: '/api/auth/sign-in/magic-link',
  signOut: '/api/auth/sign-out',
  me: '/v1/me',
  invitation: (token: string) => `/v1/invitations/${encodeURIComponent(token)}`,
  acceptInvitation: (token: string) => `/v1/invitations/${encodeURIComponent(token)}/accept`,
} as const;

export class HttpAuthClient implements AuthClient {
  constructor(
    private readonly apiUrl: string,
    private readonly fetchImpl: typeof fetch = (...args) => fetch(...args),
  ) {}

  private async request(path: string, init: RequestInit = {}): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.apiUrl}${path}`, {
        ...init,
        credentials: 'include',
        headers: {
          accept: 'application/json',
          ...(init.body ? { 'content-type': 'application/json' } : {}),
          ...init.headers,
        },
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
    return InvitationPreview.parse(await this.request(AUTH_PATHS.invitation(token)));
  }

  async acceptInvitation(token: string): Promise<AcceptInvitationResponse> {
    return AcceptInvitationResponse.parse(
      await this.post(
        AUTH_PATHS.acceptInvitation(token),
        {},
        { 'Idempotency-Key': `accept-${token}` },
      ),
    );
  }
}
