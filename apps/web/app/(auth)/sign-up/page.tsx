import type { Metadata } from 'next';
import { safeNextPath } from '@/lib/auth/client';
import { SignUpForm } from './SignUpForm';

export const metadata: Metadata = { title: 'Create account' };

/** The verification link signs the user in and lands here; `/` routes on to workspace setup. */
const DEFAULT_TARGET = '/';

export default async function SignUpPage({ searchParams }: PageProps<'/sign-up'>) {
  const { next } = await searchParams;
  return <SignUpForm next={safeNextPath(typeof next === 'string' ? next : null, DEFAULT_TARGET)} />;
}
