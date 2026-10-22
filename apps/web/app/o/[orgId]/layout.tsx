import { Uuid } from '@geo-ie-accounting/contracts';
import { notFound } from 'next/navigation';
import { RememberWorkspace } from '@/components/workspace/RememberWorkspace';
import { requireSession } from '@/lib/auth/require-session';
import { OrgShell } from './_shell/OrgShell';

/**
 * Every /o/:orgId page: requires a session and a membership in that org. A user who is not a
 * member gets 404, not 403, matching the API's tenancy rule (no leaking that the org exists).
 */
export default async function OrgLayout({ params, children }: LayoutProps<'/o/[orgId]'>) {
  const { orgId } = await params;
  if (!Uuid.safeParse(orgId).success) notFound();

  // Signed out: back to this page (with its query) after sign-in.
  const session = await requireSession(`/o/${orgId}`);
  if (!session.memberships.some((m) => m.orgId === orgId)) notFound();

  return (
    <OrgShell orgId={orgId} session={session}>
      <RememberWorkspace orgId={orgId} />
      {children}
    </OrgShell>
  );
}
