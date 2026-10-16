import type { Metadata } from 'next';
import { safeNextPath } from '@/lib/auth/client';
import { DEMO_ORGS } from '@/lib/auth/mock-data';
import { orgHref } from '@/lib/nav';
import { SignUpForm } from './SignUpForm';

export const metadata: Metadata = { title: 'Create account' };

// TODO(WS-05/WS-06): after sign-up, send new owners to workspace creation (POST /v1/orgs).
const DEFAULT_TARGET = orgHref(DEMO_ORGS[0].orgId);

export default async function SignUpPage({ searchParams }: PageProps<'/sign-up'>) {
  const { next } = await searchParams;
  return <SignUpForm next={safeNextPath(typeof next === 'string' ? next : null, DEFAULT_TARGET)} />;
}
