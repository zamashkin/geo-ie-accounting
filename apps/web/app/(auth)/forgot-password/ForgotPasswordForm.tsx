'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { ForgotPasswordBody } from '@geo-ie-accounting/contracts';
import { Button, Card, TextField } from '@geo-ie-accounting/ui';
import type { Route } from 'next';
import Link from 'next/link';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { applyApiError, FormAlert } from '@/components/form-helpers';
import { authClient } from '@/lib/auth/client';

/** Asks for a reset link. The answer never says whether the address has an account. */
export function ForgotPasswordForm({ next }: { next: string | null }) {
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const { control, handleSubmit, setError, formState } = useForm<ForgotPasswordBody>({
    resolver: zodResolver(ForgotPasswordBody),
    defaultValues: { email: '' },
  });
  const signInHref = (next ? `/sign-in?next=${encodeURIComponent(next)}` : '/sign-in') as Route;

  const onSubmit = handleSubmit(async ({ email }) => {
    setFormError(null);
    try {
      await authClient().requestPasswordReset(email, next ?? undefined);
      setSentTo(email);
    } catch (err) {
      setFormError(applyApiError(err, setError, ['email']));
    }
  });

  return (
    <Card className="flex flex-col gap-4 p-5 sm:p-6">
      <div>
        <h1 className="mb-1 text-xl font-semibold tracking-tight">Reset your password</h1>
        <p className="text-sm text-fg-muted">
          Enter the email you sign in with. We send a link to choose a new password.
        </p>
      </div>
      {sentTo ? (
        <FormAlert tone="success">
          If <strong>{sentTo}</strong> has an account, a reset link is on its way. It works once and
          expires in an hour.
        </FormAlert>
      ) : (
        <form onSubmit={(e) => void onSubmit(e)} noValidate className="flex flex-col gap-4">
          {formError ? <FormAlert>{formError}</FormAlert> : null}
          <Controller
            control={control}
            name="email"
            render={({ field, fieldState }) => (
              <TextField
                label="Email"
                type="email"
                autoComplete="email"
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
          <Button type="submit" isPending={formState.isSubmitting} className="w-full">
            Send reset link
          </Button>
        </form>
      )}
      <Link
        href={signInHref}
        className="text-sm font-medium text-accent underline-offset-4 hover:underline"
      >
        Back to sign in
      </Link>
    </Card>
  );
}
