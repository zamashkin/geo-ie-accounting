import 'server-only';
import { getSession } from './server';

/**
 * The signed-in user's role in an org, for showing or hiding write actions. The org layout has
 * already checked the membership; the API enforces roles on every request regardless. A
 * read-only login (the public demo) counts as a viewer whatever its membership says.
 */
export async function orgRole(orgId: string): Promise<'owner' | 'accountant' | 'viewer' | null> {
  const session = await getSession();
  const role = session?.memberships.find((m) => m.orgId === orgId)?.role ?? null;
  return role !== null && session?.user.readOnly ? 'viewer' : role;
}

/** Owners and accountants can import, commit and reverse. */
export function canWrite(role: 'owner' | 'accountant' | 'viewer' | null): boolean {
  return role === 'owner' || role === 'accountant';
}
