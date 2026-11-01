'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  ChangeEmailBody,
  ChangePasswordForm,
  PASSWORD_MIN_LENGTH,
  type SessionUser,
  UpdateNameBody,
} from '@geo-ie-accounting/contracts';
import { Badge, Button, Card, SkeletonText, TextField, toast } from '@geo-ie-accounting/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { type ReactNode, useState } from 'react';
import { Controller, type FieldValues, type Path, useForm, type Control } from 'react-hook-form';
import { applyApiError, FormAlert } from '@/components/form-helpers';
import { Notice } from '@/components/Notice';
import { errorMessage } from '@/lib/api/api-error';
import { newIdempotencyKey } from '@/lib/api/browser';
import { accountKeys, type AccountSession, listSessions, revokeSession } from '@/lib/api/members';
import { authClient } from '@/lib/auth/client';
import { formatTimestamp } from '@/lib/format';

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <Card className="flex flex-col gap-4 p-5 sm:p-6">
      <section aria-labelledby={id} className="flex flex-col gap-4">
        <h2 id={id} className="text-base font-semibold">
          {title}
        </h2>
        {children}
      </section>
    </Card>
  );
}

function Field<T extends FieldValues>({
  control,
  name,
  label,
  type = 'text',
  autoComplete,
  description,
}: {
  control: Control<T>;
  name: Path<T>;
  label: string;
  type?: 'text' | 'email' | 'password';
  autoComplete: string;
  description?: string;
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <TextField
          label={label}
          type={type}
          autoComplete={autoComplete}
          isRequired
          {...(description ? { description } : {})}
          value={field.value}
          onChange={field.onChange}
          onBlur={field.onBlur}
          name={field.name}
          isInvalid={fieldState.invalid}
          errorMessage={fieldState.error?.message ?? ''}
        />
      )}
    />
  );
}

function NameForm({ name }: { name: string }) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const { control, handleSubmit, setError, formState } = useForm<UpdateNameBody>({
    resolver: zodResolver(UpdateNameBody),
    defaultValues: { name },
  });
  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await authClient().updateName(values.name);
      toast({ title: 'Name saved', tone: 'positive' });
      router.refresh();
    } catch (err) {
      setFormError(applyApiError(err, setError, ['name']));
    }
  });
  return (
    <form onSubmit={(e) => void onSubmit(e)} noValidate className="flex flex-col gap-3">
      {formError ? <FormAlert>{formError}</FormAlert> : null}
      <Field control={control} name="name" label="Your name" autoComplete="name" />
      <Button
        type="submit"
        variant="secondary"
        isPending={formState.isSubmitting}
        className="self-start"
      >
        Save name
      </Button>
    </form>
  );
}

function EmailForm({ email }: { email: string }) {
  const [sentFor, setSentFor] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const { control, handleSubmit, setError, formState } = useForm<ChangeEmailBody>({
    resolver: zodResolver(ChangeEmailBody),
    defaultValues: { newEmail: '' },
  });
  const onSubmit = handleSubmit(async ({ newEmail }) => {
    setFormError(null);
    try {
      await authClient().changeEmail(newEmail, '/account');
      setSentFor(newEmail);
    } catch (err) {
      setFormError(applyApiError(err, setError, ['newEmail']));
    }
  });
  if (sentFor) {
    return (
      <FormAlert tone="success">
        To change it to <strong>{sentFor}</strong>, open the confirmation link we sent to{' '}
        <strong>{email}</strong>, then the verification link sent to the new address.
      </FormAlert>
    );
  }
  return (
    <form onSubmit={(e) => void onSubmit(e)} noValidate className="flex flex-col gap-3">
      {formError ? <FormAlert>{formError}</FormAlert> : null}
      <Field
        control={control}
        name="newEmail"
        label="New email"
        type="email"
        autoComplete="email"
        description="Your current address confirms the change first."
      />
      <Button
        type="submit"
        variant="secondary"
        isPending={formState.isSubmitting}
        className="self-start"
      >
        Change email
      </Button>
    </form>
  );
}

function PasswordForm() {
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const { control, handleSubmit, setError, formState, reset } = useForm<ChangePasswordForm>({
    resolver: zodResolver(ChangePasswordForm),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });
  const onSubmit = handleSubmit(async ({ currentPassword, newPassword }) => {
    setFormError(null);
    try {
      await authClient().changePassword(currentPassword, newPassword);
      reset();
      toast({
        title: 'Password changed',
        description: 'Your other sessions are signed out.',
        tone: 'positive',
      });
      await queryClient.invalidateQueries({ queryKey: accountKeys.sessions });
    } catch (err) {
      setFormError(applyApiError(err, setError, ['currentPassword', 'newPassword']));
    }
  });
  return (
    <form onSubmit={(e) => void onSubmit(e)} noValidate className="flex flex-col gap-3">
      {formError ? <FormAlert>{formError}</FormAlert> : null}
      <Field
        control={control}
        name="currentPassword"
        label="Current password"
        type="password"
        autoComplete="current-password"
      />
      <Field
        control={control}
        name="newPassword"
        label="New password"
        type="password"
        autoComplete="new-password"
        description={`At least ${PASSWORD_MIN_LENGTH} characters.`}
      />
      <Field
        control={control}
        name="confirmPassword"
        label="Repeat the new password"
        type="password"
        autoComplete="new-password"
      />
      <Button
        type="submit"
        variant="secondary"
        isPending={formState.isSubmitting}
        className="self-start"
      >
        Change password
      </Button>
    </form>
  );
}

/** "Firefox on macOS" from a user agent string; good enough to tell devices apart. */
function describeDevice(userAgent: string | null): string {
  if (!userAgent) return 'Unknown device';
  const browser =
    [
      ['Edg/', 'Edge'],
      ['Firefox/', 'Firefox'],
      ['Chrome/', 'Chrome'],
      ['Safari/', 'Safari'],
    ].find(([needle]) => userAgent.includes(needle ?? ''))?.[1] ?? 'Browser';
  const os =
    [
      ['iPhone', 'iOS'],
      ['iPad', 'iPadOS'],
      ['Android', 'Android'],
      ['Mac OS X', 'macOS'],
      ['Windows', 'Windows'],
      ['Linux', 'Linux'],
    ].find(([needle]) => userAgent.includes(needle ?? ''))?.[1] ?? null;
  return os ? `${browser} on ${os}` : browser;
}

function Sessions({ readOnly }: { readOnly: boolean }) {
  const queryClient = useQueryClient();
  const sessions = useQuery({ queryKey: accountKeys.sessions, queryFn: listSessions });
  const revoke = useMutation({
    mutationFn: (s: AccountSession) => revokeSession(s.id, newIdempotencyKey()),
    onSuccess: async () => {
      toast({ title: 'Session signed out', tone: 'positive' });
      await queryClient.invalidateQueries({ queryKey: accountKeys.sessions });
    },
    onError: (err) => {
      toast({ title: 'Not signed out', description: errorMessage(err), tone: 'negative' });
    },
  });

  if (sessions.isPending) return <SkeletonText lines={3} />;
  if (sessions.isError) {
    return <Notice tone="error">{errorMessage(sessions.error)}</Notice>;
  }
  return (
    <ul aria-label="Sessions" className="flex flex-col">
      {sessions.data.map((s) => (
        <li
          key={s.id}
          className="flex flex-wrap items-center gap-3 border-b border-line py-3 first:pt-0 last:border-b-0 last:pb-0"
        >
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="flex flex-wrap items-center gap-2 font-medium">
              {describeDevice(s.userAgent)}
              {s.current ? <Badge tone="accent">This device</Badge> : null}
            </span>
            <span className="text-sm text-fg-muted">
              Signed in {formatTimestamp(s.createdAt)}, last active {formatTimestamp(s.updatedAt)}
            </span>
          </div>
          {s.current || readOnly ? null : (
            <Button
              variant="ghost"
              size="sm"
              isDisabled={revoke.isPending}
              onPress={() => {
                revoke.mutate(s);
              }}
            >
              Sign out
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}

const EMAIL_LINK_ERRORS: Record<string, string> = {
  TOKEN_EXPIRED: 'That email link has expired. Ask for the change again.',
  INVALID_TOKEN: 'That email link is not valid. Ask for the change again.',
};

export function AccountView({
  user,
  emailLinkError,
}: {
  user: SessionUser;
  emailLinkError: string | null;
}) {
  const readOnly = user.readOnly;
  return (
    <div className="flex flex-col gap-6">
      {readOnly ? (
        <Notice tone="info">
          This is the read-only demo login: you can look, but the account cannot be changed.
        </Notice>
      ) : null}
      {emailLinkError ? (
        <Notice tone="error">
          {EMAIL_LINK_ERRORS[emailLinkError] ?? 'That email link did not work. Try again.'}
        </Notice>
      ) : null}

      <Section id="profile-heading" title="Profile">
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-fg-muted">Name</dt>
            <dd className="font-medium">{user.name}</dd>
          </div>
          <div>
            <dt className="text-fg-muted">Email</dt>
            <dd className="font-medium break-all">{user.email}</dd>
          </div>
        </dl>
        {readOnly ? null : (
          <>
            <NameForm name={user.name} />
            <hr className="border-line" />
            <EmailForm email={user.email} />
          </>
        )}
      </Section>

      {readOnly ? null : (
        <Section id="password-heading" title="Password">
          <p className="text-sm text-fg-muted">Changing it signs you out on every other device.</p>
          <PasswordForm />
        </Section>
      )}

      <Section id="sessions-heading" title="Where you are signed in">
        <Sessions readOnly={readOnly} />
      </Section>
    </div>
  );
}
