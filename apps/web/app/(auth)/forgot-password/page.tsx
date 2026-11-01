import type { Metadata } from 'next';
import { safeNextPath } from '@/lib/auth/next-path';
import { ForgotPasswordForm } from './ForgotPasswordForm';

export const metadata: Metadata = { title: 'Reset password' };

export default async function ForgotPasswordPage({ searchParams }: PageProps<'/forgot-password'>) {
  const { next } = await searchParams;
  const target = safeNextPath(typeof next === 'string' ? next : null, '/');
  return <ForgotPasswordForm next={target === '/' ? null : target} />;
}
