import { PAGE_LIMIT_MAX } from '@geo-ie-accounting/contracts';
import { PageContainer, PageHeader } from '@geo-ie-accounting/ui';
import type { Metadata } from 'next';
import { serverApi, serverRead } from '@/lib/api/server';
import { orgRole } from '@/lib/auth/role';
import { getSession } from '@/lib/auth/server';
import { orgHref } from '@/lib/nav';
import { MembersView } from './MembersView';

export const metadata: Metadata = { title: 'Members' };

export default async function MembersPage({ params }: PageProps<'/o/[orgId]/settings/members'>) {
  const { orgId } = await params;
  const here = orgHref(orgId, '/settings/members');
  const api = await serverApi();
  const [session, role, members] = await Promise.all([
    getSession(),
    orgRole(orgId),
    serverRead(
      api.GET('/v1/orgs/{orgId}/members', {
        params: { path: { orgId }, query: { limit: PAGE_LIMIT_MAX } },
      }),
      here,
    ),
  ]);
  const isOwner = role === 'owner';
  // Pending invitations are the owners' business (the API answers 403 to anyone else).
  const invitations = isOwner
    ? await serverRead(
        api.GET('/v1/orgs/{orgId}/invitations', { params: { path: { orgId } } }),
        here,
      )
    : null;

  return (
    <PageContainer className="max-w-3xl">
      <PageHeader
        title="Members"
        description="People with access to this workspace and what they can do."
      />
      <MembersView
        orgId={orgId}
        currentUserId={session?.user.id ?? ''}
        readOnly={session?.user.readOnly === true}
        isOwner={isOwner}
        members={members.items}
        invitations={invitations?.items ?? null}
      />
    </PageContainer>
  );
}
