import 'server-only';
import { getSession } from './server';

/**
 * The signed-in user's role in an org, for showing or hiding write actions. The org layout has
 * already checked the membership; the API enforces roles on every request regardless.
 */
export async function orgRole(orgId: string): Promise<'owner' | 'accountant' | 'viewer' | null> {
  const session = await getSession();
  return session?.memberships.find((m) => m.orgId === orgId)?.role ?? null;
}

/** Owners and accountants can import, commit and reverse. */
export function canWrite(role: 'owner' | 'accountant' | 'viewer' | null): boolean {
  return role === 'owner' || role === 'accountant';
}
