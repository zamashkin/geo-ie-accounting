'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { MagicLinkBody, SignInBody } from '@ie-ledger/contracts';
import { Button, Card, Tab, TabList, TabPanel, Tabs, TextField } from '@ie-ledger/ui';
import type { Route } from 'next';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { authClient } from '@/lib/auth/client';
import { applyApiError, FormAlert } from '@/components/form-helpers';

function PasswordForm({ next }: { next: string }) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const { control, handleSubmit, setError, formState } = useForm<SignInBody>({
    resolver: zodResolver(SignInBody),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await authClient().signIn(values);
      router.replace(next as Route);
      router.refresh();
    } catch (err) {
      setFormError(applyApiError(err, setError, ['email', 'password']));
    }
  });

  return (
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
      <Controller
        control={control}
        name="password"
        render={({ field, fieldState }) => (
          <TextField
            label="Password"
            type="password"
            autoComplete="current-password"
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
        Sign in
      </Button>
    </form>
  );
}

function MagicLinkForm({ next }: { next: string }) {
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const { control, handleSubmit, setError, formState } = useForm<MagicLinkBody>({
    resolver: zodResolver(MagicLinkBody),
    defaultValues: { email: '' },
  });

  const onSubmit = handleSubmit(async ({ email }) => {
    setFormError(null);
    try {
      await authClient().requestMagicLink({ email, callbackURL: next });
      setSentTo(email);
    } catch (err) {
      setFormError(applyApiError(err, setError, ['email']));
    }
  });

  if (sentTo) {
    return (
      <FormAlert tone="success">
        Check <strong>{sentTo}</strong> for a sign-in link. It works once and expires soon.
      </FormAlert>
    );
  }

  return (
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
            description="We email you a one-time link. No password needed."
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
        Email me a link
      </Button>
    </form>
  );
}

export function SignInForm({ next }: { next: string }) {
  return (
    <Card className="p-5 sm:p-6">
      <h1 className="mb-1 text-xl font-semibold tracking-tight">Sign in</h1>
      <p className="mb-5 text-sm text-fg-muted">
        No account yet?{' '}
        <Link
          href="/sign-up"
          className="font-medium text-accent underline-offset-4 hover:underline"
        >
          Create one
        </Link>
      </p>
      <Tabs>
        <TabList aria-label="Sign-in method">
          <Tab id="password">Password</Tab>
          <Tab id="link">Email link</Tab>
        </TabList>
        <TabPanel id="password">
          <PasswordForm next={next} />
        </TabPanel>
        <TabPanel id="link">
          <MagicLinkForm next={next} />
        </TabPanel>
      </Tabs>
    </Card>
  );
}
