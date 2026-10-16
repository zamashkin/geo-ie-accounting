import type {
  AcceptInvitationResponse,
  InvitationPreview,
  MagicLinkBody,
  MeResponse,
  SignInBody,
  SignUpBody,
} from '@ie-ledger/contracts';

/**
 * What the auth pages need from the backend. Two implementations: `HttpAuthClient` (Better
 * Auth in the API, WS-05) and `MockAuthClient` (local, until WS-05 is merged). Every method
 * throws `ApiError` on failure.
 */
export interface AuthClient {
  signIn(body: SignInBody): Promise<void>;
  /** Creates the account and sends a verification email. No session until verified. */
  signUp(body: SignUpBody): Promise<void>;
  /** Sends a one-time sign-in link by email. Resolves even for unknown emails. */
  requestMagicLink(body: MagicLinkBody): Promise<void>;
  signOut(): Promise<void>;
  /** The current session, or null when signed out. */
  getSession(): Promise<MeResponse | null>;
  getInvitation(token: string): Promise<InvitationPreview>;
  /** Requires a session whose email matches the invitation. */
  acceptInvitation(token: string): Promise<AcceptInvitationResponse>;
}
