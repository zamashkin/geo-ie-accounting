import { connection } from 'next/server';
import { getHealth } from '@/lib/api/server';
import { describeHealth } from '@/lib/health';

export default async function HomePage() {
  // Render per request: the page shows live API health.
  await connection();
  const health = describeHealth(await getHealth());

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-16">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">IE Ledger</h1>
        <p className="mt-2 text-slate-600">
          Bookkeeping and tax figures for individual entrepreneurs on Georgia&apos;s 1% small
          business regime.
        </p>
      </header>

      <section aria-labelledby="api-status" className="rounded-lg border border-slate-200 p-4">
        <h2 id="api-status" className="text-sm font-medium text-slate-500">
          API status
        </h2>
        <p className="mt-1 flex items-center gap-2 text-lg" role="status">
          <span
            aria-hidden="true"
            className={`inline-block h-2.5 w-2.5 rounded-full ${health.tone === 'ok' ? 'bg-emerald-500' : health.tone === 'warn' ? 'bg-amber-500' : 'bg-red-500'}`}
          />
          {health.label}
        </p>
        {health.detail ? <p className="mt-1 text-sm text-slate-500">{health.detail}</p> : null}
      </section>
    </main>
  );
}
