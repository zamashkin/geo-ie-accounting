'use client';

import type { InvitationPreview } from '@ie-ledger/contracts';
import { Badge, Button, ButtonLink, Card, LoadingRegion, SkeletonText } from '@ie-ledger/ui';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { errorMessage } from '@/lib/api/errors';
import { authClient } from '@/lib/auth/client';
import { orgHref } from '@/lib/nav';
import { FormAlert } from '../../_components/form-helpers';

const STATUS_TEXT: Record<Exclude<InvitationPreview['status'], 'pending'>, string> = {
  accepted: 'This invitation has already been accepted.',
  expired: 'This invitation has expired. Ask the workspace owner to send a new one.',
  revoked: 'This invitation was withdrawn by the workspace owner.',
};

export function InviteCard({ token }: { token: string }) {
  const router = useRouter();
  const invitation = useQuery({
    queryKey: ['invitation', token],
    queryFn: () => authClient().getInvitation(token),
  });
  const accept = useMutation({
    mutationFn: () => authClient().acceptInvitation(token),
    onSuccess: ({ orgId }) => {
      router.replace(orgHref(orgId) as Route);
    },
  });

  if (invitation.isPending) {
    return (
      <Card className="p-5 sm:p-6">
        <LoadingRegion label="Loading invitation">
          <SkeletonText lines={4} />
        </LoadingRegion>
      </Card>
    );
  }

  if (invitation.isError) {
    return (
      <Card className="flex flex-col gap-4 p-5 sm:p-6">
        <h1 className="text-xl font-semibold tracking-tight">Invitation not available</h1>
        <FormAlert>{errorMessage(invitation.error)}</FormAlert>
        <ButtonLink href="/sign-in" variant="secondary">
          Go to sign in
        </ButtonLink>
      </Card>
    );
  }

  const inv = invitation.data;
  return (
    <Card className="flex flex-col gap-4 p-5 sm:p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">Join {inv.orgName}</h1>
        <p className="text-sm text-fg-muted">
          This invitation is for <strong className="text-fg">{inv.email}</strong>.
        </p>
      </div>
      <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 text-sm">
        <dt className="text-fg-muted">Role</dt>
        <dd>
          <Badge tone="accent" className="capitalize">
            {inv.role}
          </Badge>
        </dd>
        <dt className="text-fg-muted">Expires</dt>
        <dd>
          <time dateTime={inv.expiresAt}>
            {new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' }).format(
              new Date(inv.expiresAt),
            )}
          </time>
        </dd>
      </dl>
      {inv.status === 'pending' ? (
        <>
          {accept.isError ? <FormAlert>{errorMessage(accept.error)}</FormAlert> : null}
          <Button
            isPending={accept.isPending}
            onPress={() => {
              accept.mutate();
            }}
            className="w-full"
          >
            Accept invitation
          </Button>
          <p className="text-xs text-fg-muted">
            You need to be signed in as {inv.email}.{' '}
            <a
              href={`/sign-in?next=${encodeURIComponent(`/invite/${token}`)}`}
              className="font-medium text-accent underline-offset-4 hover:underline"
            >
              Sign in
            </a>{' '}
            or{' '}
            <a
              href={`/sign-up?next=${encodeURIComponent(`/invite/${token}`)}`}
              className="font-medium text-accent underline-offset-4 hover:underline"
            >
              create an account
            </a>{' '}
            first.
          </p>
        </>
      ) : (
        <FormAlert>{STATUS_TEXT[inv.status]}</FormAlert>
      )}
    </Card>
  );
}
