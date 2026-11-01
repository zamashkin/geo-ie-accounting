import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { BrandMark } from '@/components/BrandMark';
import { requireSession } from '@/lib/auth/require-session';
import { NEW_ORG_PATH } from '@/lib/nav';
import { NewOrgFlow } from './NewOrgFlow';

export const metadata: Metadata = { title: 'New workspace' };

/**
 * First run (no workspace yet) and "New workspace" from the switcher: create the workspace,
 * then set the small-business status start date. `?org=` resumes at step two after a reload.
 */
export default async function NewOrgPage({ searchParams }: PageProps<'/orgs/new'>) {
  const session = await requireSession(NEW_ORG_PATH);
  // The read-only demo login cannot create workspaces.
  if (session.user.readOnly) redirect('/');
  const { org } = await searchParams;
  const membership =
    typeof org === 'string' ? session.memberships.find((m) => m.orgId === org) : undefined;

  return (
    <div className="flex min-h-dvh flex-col items-center px-4 py-10 sm:justify-center">
      <main className="flex w-full max-w-md flex-col gap-6">
        <BrandMark />
        <NewOrgFlow
          firstRun={session.memberships.length === 0}
          created={
            membership && membership.role === 'owner'
              ? { id: membership.orgId, name: membership.orgName }
              : null
          }
        />
      </main>
    </div>
  );
}
