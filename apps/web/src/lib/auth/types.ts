import type {
  AcceptInvitationResponse,
  InvitationPreview,
  MagicLinkBody,
  MeResponse,
  SignInBody,
  SignUpBody,
} from '@geo-ie-accounting/contracts';

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
  /**
   * Emails a reset link that lands on `/reset-password` (keeping `next`). Resolves the same way
   * whether or not the address has an account.
   */
  requestPasswordReset(email: string, next?: string): Promise<void>;
  /** Sets a new password with the token from the reset link. Ends every session. */
  resetPassword(token: string, newPassword: string): Promise<void>;
  /** Needs the current password. Signs out every other session. */
  changePassword(currentPassword: string, newPassword: string): Promise<void>;
  updateName(name: string): Promise<void>;
  /** Emails a confirmation link to the current address; the change lands on `callbackPath`. */
  changeEmail(newEmail: string, callbackPath: string): Promise<void>;
  getInvitation(token: string): Promise<InvitationPreview>;
  /** Requires a session whose email matches the invitation. */
  acceptInvitation(token: string): Promise<AcceptInvitationResponse>;
}
