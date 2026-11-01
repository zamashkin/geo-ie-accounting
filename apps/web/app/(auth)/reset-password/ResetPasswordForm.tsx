'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  PASSWORD_MIN_LENGTH,
  ResetPasswordForm as ResetSchema,
} from '@geo-ie-accounting/contracts';
import { ButtonLink, Button, Card, TextField } from '@geo-ie-accounting/ui';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { applyApiError, FormAlert } from '@/components/form-helpers';
import { authClient } from '@/lib/auth/client';
import { authErrorCode } from '@/lib/auth/http-client';

function InvalidLink({ next }: { next: string | null }) {
  const href = (
    next ? `/forgot-password?next=${encodeURIComponent(next)}` : '/forgot-password'
  ) as Route;
  return (
    <Card className="flex flex-col gap-4 p-5 sm:p-6">
      <h1 className="text-xl font-semibold tracking-tight">This link no longer works</h1>
      <FormAlert>
        The reset link is invalid, was already used or has expired (links last an hour). Ask for a
        new one.
      </FormAlert>
      <ButtonLink href={href}>Send a new link</ButtonLink>
    </Card>
  );
}

const FIELDS = [
  {
    name: 'newPassword',
    label: 'New password',
    description: `At least ${PASSWORD_MIN_LENGTH} characters.`,
  },
  { name: 'confirmPassword', label: 'Repeat the new password', description: null },
] as const;

export function ResetPasswordForm({ token, next }: { token: string | null; next: string | null }) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const [expired, setExpired] = useState(token === null);
  const { control, handleSubmit, setError, formState } = useForm<ResetSchema>({
    resolver: zodResolver(ResetSchema),
    defaultValues: { newPassword: '', confirmPassword: '' },
  });

  const onSubmit = handleSubmit(async ({ newPassword }) => {
    if (!token) return;
    setFormError(null);
    try {
      await authClient().resetPassword(token, newPassword);
      // Better Auth ends every session on reset and does not sign in: sign in with the new one.
      const query = new URLSearchParams({ reset: '1', ...(next ? { next } : {}) });
      router.replace(`/sign-in?${query.toString()}` as Route);
    } catch (err) {
      if (authErrorCode(err) === 'INVALID_TOKEN') setExpired(true);
      else setFormError(applyApiError(err, setError, ['newPassword']));
    }
  });

  if (expired) return <InvalidLink next={next} />;

  return (
    <Card className="p-5 sm:p-6">
      <h1 className="mb-1 text-xl font-semibold tracking-tight">Choose a new password</h1>
      <p className="mb-5 text-sm text-fg-muted">
        You are signed out everywhere once it is saved, then sign in with the new password.
      </p>
      <form onSubmit={(e) => void onSubmit(e)} noValidate className="flex flex-col gap-4">
        {formError ? <FormAlert>{formError}</FormAlert> : null}
        {FIELDS.map((f) => (
          <Controller
            key={f.name}
            control={control}
            name={f.name}
            render={({ field, fieldState }) => (
              <TextField
                label={f.label}
                type="password"
                autoComplete="new-password"
                isRequired
                {...(f.description ? { description: f.description } : {})}
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                name={field.name}
                isInvalid={fieldState.invalid}
                errorMessage={fieldState.error?.message ?? ''}
              />
            )}
          />
        ))}
        <Button type="submit" isPending={formState.isSubmitting} className="w-full">
          Save new password
        </Button>
      </form>
    </Card>
  );
}
