import { and, desc, eq, gt } from 'drizzle-orm';
import type { DbOrTx } from '../client';
import { authSessions } from '../schema/index';

// Better Auth's sessions (`auth_sessions`), read and revoked by id for the account page.
// Tokens never leave this module: Better Auth's own list-sessions endpoint returns them.

export interface SessionRow {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
  userAgent: string | null;
  ipAddress: string | null;
}

const SESSION_COLUMNS = {
  id: authSessions.id,
  createdAt: authSessions.createdAt,
  updatedAt: authSessions.updatedAt,
  expiresAt: authSessions.expiresAt,
  userAgent: authSessions.userAgent,
  ipAddress: authSessions.ipAddress,
};

/** The user's unexpired sessions, most recently used first. */
export async function listActiveSessions(
  db: DbOrTx,
  userId: string,
  now: Date = new Date(),
): Promise<SessionRow[]> {
  return db
    .select(SESSION_COLUMNS)
    .from(authSessions)
    .where(and(eq(authSessions.userId, userId), gt(authSessions.expiresAt, now)))
    .orderBy(desc(authSessions.updatedAt));
}

/** Deletes one of the user's sessions. Null when it does not exist or is someone else's. */
export async function deleteUserSession(
  db: DbOrTx,
  userId: string,
  sessionId: string,
): Promise<SessionRow | null> {
  const [row] = await db
    .delete(authSessions)
    .where(and(eq(authSessions.userId, userId), eq(authSessions.id, sessionId)))
    .returning(SESSION_COLUMNS);
  return row ?? null;
}
