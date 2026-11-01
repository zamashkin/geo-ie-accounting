'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { CreateInvitationRequest } from '@geo-ie-accounting/contracts';
import {
  Badge,
  Button,
  Card,
  Dialog,
  DialogFooter,
  Select,
  TextField,
  toast,
} from '@geo-ie-accounting/ui';
import { useMutation } from '@tanstack/react-query';
import { LogOut, Mail, Plus, RotateCw, UserMinus, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { applyApiError, FormAlert } from '@/components/form-helpers';
import { Notice } from '@/components/Notice';
import { errorMessage } from '@/lib/api/api-error';
import { newIdempotencyKey } from '@/lib/api/browser';
import {
  createInvitation,
  type Invitation,
  type Member,
  removeMember,
  resendInvitation,
  revokeInvitation,
  type Role,
  updateMemberRole,
} from '@/lib/api/members';
import { formatIsoDate } from '@/lib/format';

const ROLE_OPTIONS: { id: Role; label: string; description: string }[] = [
  { id: 'owner', label: 'Owner', description: 'Everything, including members and settings' },
  { id: 'accountant', label: 'Accountant', description: 'Books, imports, invoices, filings' },
  { id: 'viewer', label: 'Viewer', description: 'Reads everything, changes nothing' },
];
const roleLabel = (role: Role) => ROLE_OPTIONS.find((r) => r.id === role)?.label ?? role;

type Confirm = { kind: 'remove'; member: Member } | { kind: 'leave' } | null;

export function MembersView({
  orgId,
  currentUserId,
  readOnly,
  isOwner,
  members,
  invitations,
}: {
  orgId: string;
  currentUserId: string;
  readOnly: boolean;
  isOwner: boolean;
  members: Member[];
  invitations: Invitation[] | null;
}) {
  const router = useRouter();
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [inviting, setInviting] = useState(false);
  const canManage = isOwner && !readOnly;

  const changeRole = useMutation({
    mutationFn: ({ member, role }: { member: Member; role: Role }) =>
      updateMemberRole(orgId, member.userId, role, newIdempotencyKey()),
    onSuccess: (m) => {
      toast({ title: `${m.name} is now ${roleLabel(m.role).toLowerCase()}`, tone: 'positive' });
      router.refresh();
    },
    onError: (err) => {
      toast({ title: 'Role not changed', description: errorMessage(err), tone: 'negative' });
    },
  });

  const remove = useMutation({
    mutationFn: (userId: string) => removeMember(orgId, userId, newIdempotencyKey()),
    onSuccess: (m) => {
      setConfirm(null);
      if (m.userId === currentUserId) {
        toast({ title: 'You left the workspace', tone: 'positive' });
        router.replace('/');
      } else {
        toast({ title: `${m.name} was removed`, tone: 'positive' });
      }
      router.refresh();
    },
  });

  const invitationAction = useMutation({
    mutationFn: ({ inv, action }: { inv: Invitation; action: 'resend' | 'revoke' }) =>
      action === 'resend'
        ? resendInvitation(orgId, inv.id, newIdempotencyKey())
        : revokeInvitation(orgId, inv.id, newIdempotencyKey()),
    onSuccess: (inv, { action }) => {
      toast({
        title: action === 'resend' ? `Sent again to ${inv.email}` : 'Invitation revoked',
        tone: 'positive',
      });
      router.refresh();
    },
    onError: (err) => {
      toast({ title: 'That did not work', description: errorMessage(err), tone: 'negative' });
    },
  });

  return (
    <div className="flex flex-col gap-6">
      {readOnly ? (
        <Notice tone="info">The demo is read-only: roles and invitations cannot change.</Notice>
      ) : null}

      <Card className="p-0">
        <ul aria-label="Members">
          {members.map((m) => {
            const self = m.userId === currentUserId;
            return (
              <li
                key={m.userId}
                className="flex flex-wrap items-center gap-3 border-b border-line p-3 last:border-b-0 sm:p-4"
              >
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="flex flex-wrap items-center gap-2 font-medium">
                    {m.name}
                    {self ? <Badge tone="accent">You</Badge> : null}
                  </span>
                  <span className="truncate text-sm text-fg-muted">{m.email}</span>
                </div>
                {canManage ? (
                  <Select<Role>
                    aria-label={`Role of ${m.name}`}
                    className="w-40"
                    options={ROLE_OPTIONS}
                    value={m.role}
                    isDisabled={changeRole.isPending}
                    onChange={(role) => {
                      if (role && role !== m.role) changeRole.mutate({ member: m, role });
                    }}
                  />
                ) : (
                  <Badge>{roleLabel(m.role)}</Badge>
                )}
                {readOnly ? null : self ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onPress={() => {
                      remove.reset();
                      setConfirm({ kind: 'leave' });
                    }}
                  >
                    <LogOut aria-hidden />
                    Leave
                  </Button>
                ) : canManage ? (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove ${m.name}`}
                    onPress={() => {
                      remove.reset();
                      setConfirm({ kind: 'remove', member: m });
                    }}
                  >
                    <UserMinus aria-hidden />
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      </Card>

      {invitations !== null ? (
        <section aria-labelledby="invitations-heading" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="invitations-heading" className="text-base font-semibold">
              Pending invitations
            </h2>
            {canManage ? (
              <Button
                onPress={() => {
                  setInviting(true);
                }}
              >
                <Plus aria-hidden />
                Invite someone
              </Button>
            ) : null}
          </div>
          {invitations.length === 0 ? (
            <p className="text-sm text-fg-muted">No open invitations.</p>
          ) : (
            <Card className="p-0">
              <ul aria-label="Pending invitations">
                {invitations.map((inv) => (
                  <li
                    key={inv.id}
                    className="flex flex-wrap items-center gap-3 border-b border-line p-3 last:border-b-0 sm:p-4"
                  >
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate font-medium">{inv.email}</span>
                      <span className="text-sm text-fg-muted">
                        {roleLabel(inv.role)}, expires {formatIsoDate(inv.expiresAt.slice(0, 10))}
                      </span>
                    </div>
                    {canManage ? (
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          isDisabled={invitationAction.isPending}
                          onPress={() => {
                            invitationAction.mutate({ inv, action: 'resend' });
                          }}
                        >
                          <RotateCw aria-hidden />
                          Resend
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          isDisabled={invitationAction.isPending}
                          onPress={() => {
                            invitationAction.mutate({ inv, action: 'revoke' });
                          }}
                        >
                          <X aria-hidden />
                          Revoke
                        </Button>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </section>
      ) : null}

      <InviteDialog
        orgId={orgId}
        isOpen={inviting}
        onOpenChange={setInviting}
        onSent={(email) => {
          setInviting(false);
          toast({ title: `Invitation sent to ${email}`, tone: 'positive' });
          router.refresh();
        }}
      />

      <Dialog
        role="alertdialog"
        title={confirm?.kind === 'leave' ? 'Leave this workspace?' : 'Remove this member?'}
        description={
          confirm?.kind === 'leave'
            ? 'You lose access straight away. An owner can invite you again.'
            : 'They lose access straight away. Their past entries stay in the books.'
        }
        isOpen={confirm !== null}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
        size="sm"
      >
        {confirm?.kind === 'remove' ? (
          <p className="text-sm font-medium">
            {confirm.member.name} ({confirm.member.email})
          </p>
        ) : null}
        {remove.isError ? <Notice tone="error">{errorMessage(remove.error)}</Notice> : null}
        <DialogFooter>
          <Button
            variant="secondary"
            onPress={() => {
              setConfirm(null);
            }}
          >
            Cancel
          </Button>
          <Button
            variant="danger"
            isPending={remove.isPending}
            onPress={() => {
              if (confirm) {
                remove.mutate(confirm.kind === 'leave' ? currentUserId : confirm.member.userId);
              }
            }}
          >
            {confirm?.kind === 'leave' ? 'Leave workspace' : 'Remove member'}
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}

function InviteDialog({
  orgId,
  isOpen,
  onOpenChange,
  onSent,
}: {
  orgId: string;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onSent: (email: string) => void;
}) {
  const [formError, setFormError] = useState<string | null>(null);
  const [key] = useState(newIdempotencyKey);
  const { control, handleSubmit, setError, formState, reset } = useForm<CreateInvitationRequest>({
    resolver: zodResolver(CreateInvitationRequest),
    defaultValues: { email: '', role: 'accountant' },
  });

  const onSubmit = handleSubmit(async ({ email, role }) => {
    setFormError(null);
    try {
      await createInvitation(orgId, email, role, `${key}-${email}-${role}`);
      reset();
      onSent(email);
    } catch (err) {
      setFormError(applyApiError(err, setError, ['email', 'role']));
    }
  });

  return (
    <Dialog
      title="Invite someone"
      description="They get an email with a link that is valid for 7 days."
      isOpen={isOpen}
      onOpenChange={onOpenChange}
    >
      <form onSubmit={(e) => void onSubmit(e)} noValidate className="flex flex-col gap-4">
        {formError ? <FormAlert>{formError}</FormAlert> : null}
        <Controller
          control={control}
          name="email"
          render={({ field, fieldState }) => (
            <TextField
              label="Email"
              type="email"
              autoComplete="off"
              isRequired
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              name={field.name}
              isInvalid={fieldState.invalid}
              errorMessage={fieldState.error?.message ?? ''}
            />
          )}
        />
        <Controller
          control={control}
          name="role"
          render={({ field }) => (
            <Select<Role>
              label="Role"
              options={ROLE_OPTIONS}
              value={field.value}
              onChange={(role) => {
                if (role) field.onChange(role);
              }}
            />
          )}
        />
        <DialogFooter>
          <Button
            variant="secondary"
            onPress={() => {
              onOpenChange(false);
            }}
          >
            Cancel
          </Button>
          <Button type="submit" isPending={formState.isSubmitting}>
            <Mail aria-hidden />
            Send invitation
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
