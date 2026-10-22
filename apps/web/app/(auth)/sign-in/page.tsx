import type { Metadata } from 'next';
import { getPublicConfig } from '@/lib/api/server';
import { safeNextPath } from '@/lib/auth/client';
import { publicEnv } from '@/lib/public-env';
import { DemoSignIn } from './DemoSignIn';
import { SignInForm } from './SignInForm';

export const metadata: Metadata = { title: 'Sign in' };

/** `/` sends a signed-in user to their first workspace, or to workspace creation. */
const DEFAULT_TARGET = '/';

export default async function SignInPage({ searchParams }: PageProps<'/sign-in'>) {
  const { next } = await searchParams;
  const target = safeNextPath(typeof next === 'string' ? next : null, DEFAULT_TARGET);
  const mock = publicEnv().authMode === 'mock';
  const config = await getPublicConfig();
  return (
    <>
      <SignInForm next={target} signUpEnabled={config.signUpEnabled} />
      {config.demo ? <DemoSignIn login={config.demo} next={target} /> : null}
      {mock ? (
        <p className="text-center text-xs text-fg-muted">
          Demo mode: any email and password sign you in. Use the password{' '}
          <code className="font-mono">wrong-password</code> to see an error.
        </p>
      ) : process.env.NODE_ENV !== 'production' ? (
        <p className="text-center text-xs text-fg-muted">
          Local dev login: <code className="font-mono">dev@geo-ie-accounting.local</code> /{' '}
          <code className="font-mono">dev-password-2026</code> (after{' '}
          <code className="font-mono">pnpm db:seed</code>).
        </p>
      ) : null}
    </>
  );
}
