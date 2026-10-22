'use client';

import { browserApi, idempotencyHeaders } from './browser';
import type { Schemas } from './client';
import { unwrap } from './errors';

// Members, invitations and the signed-in user's sessions, for client components. Every
// mutation takes the Idempotency-Key of the user action, so a retried click replays.

export type Member = Schemas['Member'];
export type Invitation = Schemas['Invitation'];
export type Role = Member['role'];
export type AccountSession = Schemas['AccountSession'];

const api = () => browserApi();

export const accountKeys = {
  sessions: ['me', 'sessions'] as const,
};

export function updateMemberRole(orgId: string, userId: string, role: Role, key: string) {
  return unwrap(
    api().PATCH('/v1/orgs/{orgId}/members/{userId}', {
      params: { path: { orgId, userId } },
      headers: idempotencyHeaders(key),
      body: { role },
    }),
  );
}

/** Removes a member, or leaves the workspace when `userId` is the caller's own. */
export function removeMember(orgId: string, userId: string, key: string) {
  return unwrap(
    api().DELETE('/v1/orgs/{orgId}/members/{userId}', {
      params: { path: { orgId, userId } },
      headers: idempotencyHeaders(key),
    }),
  );
}

export function createInvitation(orgId: string, email: string, role: Role, key: string) {
  return unwrap(
    api().POST('/v1/orgs/{orgId}/invitations', {
      params: { path: { orgId } },
      headers: idempotencyHeaders(key),
      body: { email, role },
    }),
  );
}

export function revokeInvitation(orgId: string, invitationId: string, key: string) {
  return unwrap(
    api().POST('/v1/orgs/{orgId}/invitations/{invitationId}/revoke', {
      params: { path: { orgId, invitationId } },
      headers: idempotencyHeaders(key),
    }),
  );
}

export function resendInvitation(orgId: string, invitationId: string, key: string) {
  return unwrap(
    api().POST('/v1/orgs/{orgId}/invitations/{invitationId}/resend', {
      params: { path: { orgId, invitationId } },
      headers: idempotencyHeaders(key),
    }),
  );
}

export async function listSessions(): Promise<AccountSession[]> {
  const { items } = await unwrap(api().GET('/v1/me/sessions'));
  return items;
}

export function revokeSession(sessionId: string, key: string) {
  return unwrap(
    api().POST('/v1/me/sessions/{sessionId}/revoke', {
      params: { path: { sessionId } },
      headers: idempotencyHeaders(key),
    }),
  );
}
