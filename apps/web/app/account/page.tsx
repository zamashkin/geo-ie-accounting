import { ButtonLink, PageHeader } from '@geo-ie-accounting/ui';
import { ArrowLeft } from 'lucide-react';
import type { Metadata } from 'next';
import { BrandMark } from '@/components/BrandMark';
import { requireSession } from '@/lib/auth/require-session';
import { AccountView } from './AccountView';

export const metadata: Metadata = { title: 'Account' };

/** Your own account (not a workspace's): name, email, password and signed-in devices. */
export default async function AccountPage({ searchParams }: PageProps<'/account'>) {
  const session = await requireSession('/account');
  const { error } = await searchParams;
  return (
    <div className="flex min-h-dvh flex-col items-center px-4 py-10">
      <main className="flex w-full max-w-2xl flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <BrandMark />
          <ButtonLink href="/" variant="ghost" size="sm">
            <ArrowLeft aria-hidden />
            Back to your workspace
          </ButtonLink>
        </div>
        <PageHeader title="Account" description="How you sign in, and where you are signed in." />
        <AccountView
          user={session.user}
          emailLinkError={typeof error === 'string' ? error : null}
        />
      </main>
    </div>
  );
}
