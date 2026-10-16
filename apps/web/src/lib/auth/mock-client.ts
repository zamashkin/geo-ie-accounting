import type {
  AcceptInvitationResponse,
  InvitationPreview,
  SessionResponse,
  SignInBody,
  SignUpBody,
} from '@ie-ledger/contracts';
import { ApiError } from '../api/errors';
import {
  decodeMockSession,
  DEMO_ORGS,
  demoSession,
  encodeMockSession,
  MOCK_INVITATIONS,
  MOCK_SESSION_COOKIE,
} from './mock-data';
import type { AuthClient } from './types';

function problem(status: number, code: ApiError['problem']['code'], title: string, detail: string) {
  return new ApiError(
    { type: 'about:blank', title, status, code, detail, requestId: 'mock' },
    'problem',
  );
}

function nameFromEmail(email: string): string {
  const local = email.split('@')[0] ?? email;
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((w) => (w[0] ?? '').toUpperCase() + w.slice(1))
    .join(' ');
}

export interface MockAuthOptions {
  /** Simulated latency, so pending states are visible. */
  delayMs?: number;
  /** Cookie storage; defaults to `document.cookie`. */
  cookies?: { get(): string; set(cookie: string): void };
}

/**
 * Local stand-in for Better Auth (WS-05). Rules, so every UI state can be reached:
 * - password `wrong-password` → 401; email `taken@example.ge` on sign-up → 409;
 * - anything else signs in as a demo user with three workspaces.
 */
export class MockAuthClient implements AuthClient {
  private readonly delayMs: number;
  private readonly cookies: NonNullable<MockAuthOptions['cookies']>;

  constructor({ delayMs = 400, cookies }: MockAuthOptions = {}) {
    this.delayMs = delayMs;
    this.cookies = cookies ?? {
      get: () => document.cookie,
      set: (c) => {
        document.cookie = c;
      },
    };
  }

  private wait() {
    return new Promise((resolve) => setTimeout(resolve, this.delayMs));
  }

  private setUser(user: { email: string; name: string } | null) {
    this.cookies.set(
      user
        ? `${MOCK_SESSION_COOKIE}=${encodeMockSession(user)}; path=/; max-age=604800; samesite=lax`
        : `${MOCK_SESSION_COOKIE}=; path=/; max-age=0; samesite=lax`,
    );
  }

  async signIn({ email, password }: SignInBody): Promise<void> {
    await this.wait();
    if (password === 'wrong-password') {
      throw problem(
        401,
        'unauthenticated',
        'Invalid email or password',
        'Invalid email or password.',
      );
    }
    this.setUser({ email, name: nameFromEmail(email) });
  }

  async signUp({ email, name }: SignUpBody): Promise<void> {
    await this.wait();
    if (email === 'taken@example.ge') {
      throw new ApiError(
        {
          type: 'about:blank',
          title: 'Validation failed',
          status: 422,
          code: 'validation_failed',
          requestId: 'mock',
          detail: 'Check the highlighted fields.',
          errors: [{ path: 'email', message: 'An account with this email already exists' }],
        },
        'problem',
      );
    }
    this.setUser({ email, name });
  }

  async requestMagicLink(): Promise<void> {
    await this.wait();
  }

  async signOut(): Promise<void> {
    await this.wait();
    this.setUser(null);
  }

  async getSession(): Promise<SessionResponse | null> {
    const raw = this.cookies
      .get()
      .split('; ')
      .find((c) => c.startsWith(`${MOCK_SESSION_COOKIE}=`))
      ?.slice(MOCK_SESSION_COOKIE.length + 1);
    const user = decodeMockSession(raw);
    return user ? demoSession(user) : null;
  }

  async getInvitation(token: string): Promise<InvitationPreview> {
    await this.wait();
    const invitation = MOCK_INVITATIONS[token];
    if (!invitation) {
      throw problem(404, 'not_found', 'Invitation not found', 'This invitation link is not valid.');
    }
    return invitation;
  }

  async acceptInvitation(token: string): Promise<AcceptInvitationResponse> {
    const invitation = await this.getInvitation(token);
    if (invitation.status !== 'pending') {
      throw problem(
        409,
        'conflict',
        'Invitation not usable',
        `This invitation is ${invitation.status}.`,
      );
    }
    return { orgId: DEMO_ORGS[0].orgId, role: invitation.role };
  }
}
