import { Card } from '@geo-ie-accounting/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getPublicConfig } from '@/lib/api/server';
import { safeNextPath } from '@/lib/auth/client';
import { SignUpForm } from './SignUpForm';

export const metadata: Metadata = { title: 'Create account' };

/** The verification link signs the user in and lands here; `/` routes on to workspace setup. */
const DEFAULT_TARGET = '/';

export default async function SignUpPage({ searchParams }: PageProps<'/sign-up'>) {
  const { next } = await searchParams;
  const config = await getPublicConfig();
  if (!config.signUpEnabled) {
    // `DEMO_SIGNUP=false`: the API refuses sign-ups, so do not offer the form.
    return (
      <Card className="p-5 sm:p-6">
        <h1 className="mb-1 text-xl font-semibold tracking-tight">Sign-up is closed</h1>
        <p className="text-sm text-fg-muted">
          This server does not take new accounts.{' '}
          <Link
            href="/sign-in"
            className="font-medium text-accent underline-offset-4 hover:underline"
          >
            {config.demo ? 'Try the demo instead' : 'Sign in'}
          </Link>
          .
        </p>
      </Card>
    );
  }
  return <SignUpForm next={safeNextPath(typeof next === 'string' ? next : null, DEFAULT_TARGET)} />;
}
