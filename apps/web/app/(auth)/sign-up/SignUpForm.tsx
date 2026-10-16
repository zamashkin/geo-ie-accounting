'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { PASSWORD_MIN_LENGTH, SignUpBody } from '@ie-ledger/contracts';
import { Button, Card, TextField } from '@ie-ledger/ui';
import Link from 'next/link';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { authClient } from '@/lib/auth/client';
import { applyApiError, FormAlert } from '@/components/form-helpers';

const FIELDS = [
  { name: 'name', label: 'Your name', type: 'text', autoComplete: 'name', description: null },
  { name: 'email', label: 'Email', type: 'email', autoComplete: 'email', description: null },
  {
    name: 'password',
    label: 'Password',
    type: 'password',
    autoComplete: 'new-password',
    description: `At least ${PASSWORD_MIN_LENGTH} characters.`,
  },
] as const;

export function SignUpForm({ next }: { next: string }) {
  const [formError, setFormError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const { control, handleSubmit, setError, formState } = useForm<SignUpBody>({
    resolver: zodResolver(SignUpBody),
    defaultValues: { name: '', email: '', password: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      // The API sends a verification email; the link signs the user in and lands on `next`.
      await authClient().signUp({ ...values, callbackURL: next });
      setSentTo(values.email);
    } catch (err) {
      setFormError(applyApiError(err, setError, ['name', 'email', 'password']));
    }
  });

  if (sentTo) {
    return (
      <Card className="flex flex-col gap-4 p-5 sm:p-6">
        <h1 className="text-xl font-semibold tracking-tight">Check your email</h1>
        <FormAlert tone="success">
          We sent a verification link to <strong>{sentTo}</strong>. Open it to finish creating your
          account.
        </FormAlert>
        <Link
          href="/sign-in"
          className="text-sm font-medium text-accent underline-offset-4 hover:underline"
        >
          Back to sign in
        </Link>
      </Card>
    );
  }

  return (
    <Card className="p-5 sm:p-6">
      <h1 className="mb-1 text-xl font-semibold tracking-tight">Create your account</h1>
      <p className="mb-5 text-sm text-fg-muted">
        Already registered?{' '}
        <Link
          href="/sign-in"
          className="font-medium text-accent underline-offset-4 hover:underline"
        >
          Sign in
        </Link>
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
                type={f.type}
                autoComplete={f.autoComplete}
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
          Create account
        </Button>
      </form>
    </Card>
  );
}
