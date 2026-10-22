import type { Metadata } from 'next';
import { safeNextPath } from '@/lib/auth/next-path';
import { ResetPasswordForm } from './ResetPasswordForm';

export const metadata: Metadata = { title: 'Choose a new password' };

/**
 * The reset link goes through the API, which checks the token and redirects here with
 * `?token=` (valid when it left) or `?error=INVALID_TOKEN` (unknown, used or expired).
 */
export default async function ResetPasswordPage({ searchParams }: PageProps<'/reset-password'>) {
  const { token, error, next } = await searchParams;
  const target = safeNextPath(typeof next === 'string' ? next : null, '/');
  return (
    <ResetPasswordForm
      token={typeof token === 'string' && token.length > 0 && !error ? token : null}
      next={target === '/' ? null : target}
    />
  );
}
