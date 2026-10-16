import type { Metadata } from 'next';
import { safeNextPath } from '@/lib/auth/client';
import { DEMO_ORGS } from '@/lib/auth/mock-data';
import { orgHref } from '@/lib/nav';
import { publicEnv } from '@/lib/public-env';
import { SignInForm } from './SignInForm';

export const metadata: Metadata = { title: 'Sign in' };

// TODO(WS-05): once sessions are real, default to the user's last workspace.
const DEFAULT_TARGET = orgHref(DEMO_ORGS[0].orgId);

export default async function SignInPage({ searchParams }: PageProps<'/sign-in'>) {
  const { next } = await searchParams;
  const target = safeNextPath(typeof next === 'string' ? next : null, DEFAULT_TARGET);
  return (
    <>
      <SignInForm next={target} />
      {publicEnv().authMode === 'mock' ? (
        <p className="text-center text-xs text-fg-muted">
          Demo mode: any email and password sign you in. Use the password{' '}
          <code className="font-mono">wrong-password</code> to see an error.
        </p>
      ) : null}
    </>
  );
}
