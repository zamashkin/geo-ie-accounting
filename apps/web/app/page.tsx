import { ButtonLink } from '@ie-ledger/ui';
import type { Route } from 'next';
import { redirect } from 'next/navigation';
import { connection } from 'next/server';
import { getHealth } from '@/lib/api/server';
import { getSession } from '@/lib/auth/server';
import { describeHealth } from '@/lib/health';
import { NEW_ORG_PATH, orgHref } from '@/lib/nav';

/**
 * Signed in: straight to the first workspace, or to workspace creation when there is none.
 * Signed out: a short landing page with the API status.
 */
export default async function HomePage() {
  await connection();
  const session = await getSession().catch(() => null);
  if (session) {
    const first = session.memberships[0];
    redirect((first ? orgHref(first.orgId) : NEW_ORG_PATH) as Route);
  }
  const health = describeHealth(await getHealth());

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-16 sm:px-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">IE Ledger</h1>
        <p className="mt-2 text-fg-muted">
          Bookkeeping and tax figures for individual entrepreneurs on Georgia&apos;s 1% small
          business regime.
        </p>
      </header>
      <div className="flex flex-wrap gap-2">
        <ButtonLink href="/sign-in">Sign in</ButtonLink>
        <ButtonLink href="/sign-up" variant="secondary">
          Create account
        </ButtonLink>
      </div>

      <section aria-labelledby="api-status" className="rounded-lg border border-line p-4">
        <h2 id="api-status" className="text-sm font-medium text-fg-muted">
          API status
        </h2>
        <p className="mt-1 flex items-center gap-2 text-lg" role="status">
          <span
            aria-hidden="true"
            className={`inline-block h-2.5 w-2.5 rounded-full ${health.tone === 'ok' ? 'bg-positive' : health.tone === 'warn' ? 'bg-warning' : 'bg-negative'}`}
          />
          {health.label}
        </p>
        {health.detail ? <p className="mt-1 text-sm text-fg-muted">{health.detail}</p> : null}
      </section>
    </main>
  );
}
