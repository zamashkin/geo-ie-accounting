import type { Metadata } from 'next';
import Link from 'next/link';
import {
  displayRate,
  displaySetAt,
  fetchRates,
  PICKER_CURRENCIES,
  readFilter,
  type ExchangeRateDto,
  type RatesFilter,
} from './_lib/rates';

export const metadata: Metadata = { title: 'NBG exchange rates · geo-ie-accounting' };

// Plain server-rendered page: the filter is a GET form, so it works without client JavaScript.
// WS-04 restyles it with the UI kit.

export default async function RatesPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { filter, error } = readFilter(await props.searchParams);
  const page = error ? null : await fetchRates(filter);

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-6 px-6 py-12">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">NBG exchange rates</h1>
        <p className="mt-2 text-sm text-slate-600">
          Official rates of the National Bank of Georgia, in GEL per the quoted number of units. A
          rate applies from its &ldquo;valid from&rdquo; date until the next one: weekends and
          holidays use the last rate set, usually on the previous business day around 17:00 Tbilisi
          time.
        </p>
      </header>

      <FilterForm filter={filter} />

      {error ? (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : page?.kind === 'error' ? (
        <p role="alert" className="text-sm text-red-700">
          Could not load rates: {page.reason}
        </p>
      ) : page && page.items.length === 0 ? (
        <p className="text-sm text-slate-600">
          No rates stored for this range. Rates before the first daily sync need a backfill.
        </p>
      ) : page ? (
        <>
          <RatesTable items={page.items} />
          {page.nextCursor ? (
            <Link
              className="self-start text-sm text-blue-700 underline"
              href={{
                pathname: '/rates',
                query: { ...queryOf(filter), cursor: page.nextCursor },
              }}
            >
              Older rates
            </Link>
          ) : null}
        </>
      ) : null}
    </main>
  );
}

function queryOf(filter: RatesFilter): Record<string, string> {
  return {
    from: filter.from,
    to: filter.to,
    ...(filter.currency ? { currency: filter.currency } : {}),
  };
}

function FilterForm({ filter }: { filter: RatesFilter }) {
  const field = 'mt-1 block rounded border border-slate-300 px-2 py-1 text-sm';
  return (
    <form method="get" action="/rates" className="flex flex-wrap items-end gap-4">
      <label className="text-sm font-medium text-slate-700">
        Currency
        <select name="currency" defaultValue={filter.currency ?? ''} className={field}>
          <option value="">All</option>
          {PICKER_CURRENCIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
      <label className="text-sm font-medium text-slate-700">
        Valid from
        <input type="date" name="from" defaultValue={filter.from} required className={field} />
      </label>
      <label className="text-sm font-medium text-slate-700">
        to
        <input type="date" name="to" defaultValue={filter.to} required className={field} />
      </label>
      <button
        type="submit"
        className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white"
      >
        Show
      </button>
    </form>
  );
}

function RatesTable({ items }: { items: ExchangeRateDto[] }) {
  return (
    <table className="w-full border-collapse text-sm">
      <caption className="sr-only">Exchange rates, newest first</caption>
      <thead>
        <tr className="border-b border-slate-300 text-left text-slate-500">
          <th scope="col" className="py-2 pr-4 font-medium">
            Valid from
          </th>
          <th scope="col" className="py-2 pr-4 font-medium">
            Currency
          </th>
          <th scope="col" className="py-2 pr-4 text-right font-medium">
            Units
          </th>
          <th scope="col" className="py-2 pr-4 text-right font-medium">
            GEL
          </th>
          <th scope="col" className="py-2 font-medium">
            Set by NBG (Tbilisi)
          </th>
        </tr>
      </thead>
      <tbody>
        {items.map((r) => (
          <tr key={r.id} className="border-b border-slate-100">
            <td className="py-1.5 pr-4 tabular-nums">{r.validFrom}</td>
            <td className="py-1.5 pr-4">{r.currency}</td>
            <td className="py-1.5 pr-4 text-right tabular-nums">{r.quantity}</td>
            <td className="py-1.5 pr-4 text-right tabular-nums">{displayRate(r.rate)}</td>
            <td className="py-1.5 text-slate-600">{displaySetAt(r.setAt)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
