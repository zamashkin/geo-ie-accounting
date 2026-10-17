// Records the real NBG rates the demo workspaces book with into fixtures/nbg/demo-rates.json.
// Uses the live network: run by hand, never in tests.
//
//   pnpm --filter @geo-ie-accounting/nbg record-demo-rates [from] [to]
//
// Asks NBG for EUR, GBP and USD on every calendar day of the range and keeps each published
// rate once (keyed by currency and validFromDate). Weekends and holidays need no row of their
// own: the rate valid on a date is the row with the greatest validFrom on or before it.
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const ENDPOINT = 'https://nbg.gov.ge/gw/api/ct/monetarypolicy/currencies/en/json/';
const OUT = fileURLToPath(new URL('../../../fixtures/nbg/demo-rates.json', import.meta.url));
const CURRENCIES = ['EUR', 'GBP', 'USD'];
const CONCURRENCY = 4;

interface Entry {
  code: string;
  quantity: number;
  rateFormated: string;
  /** When NBG set the rate (Tbilisi wall-clock time with a `Z` suffix). */
  date: string;
  validFromDate: string;
}

const tbilisiToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tbilisi' }).format(
  new Date(),
);
const from = process.argv[2] ?? '2025-01-01';
const to = process.argv[3] ?? tbilisiToday;

function days(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = new Date(`${start}T00:00:00Z`); d <= new Date(`${end}T00:00:00Z`);) {
    out.push(d.toISOString().slice(0, 10));
    d = new Date(d.getTime() + 86_400_000);
  }
  return out;
}

async function fetchDay(date: string): Promise<Entry[]> {
  const url = new URL(ENDPOINT);
  for (const code of CURRENCIES) url.searchParams.append('currencies', code);
  url.searchParams.set('date', date);
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { currencies: Entry[] }[];
      return body.flatMap((g) => g.currencies);
    } catch (err) {
      if (attempt >= 3) throw new Error(`${url.href}: ${String(err)}`);
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    }
  }
}

const queue = days(from, to);
const byKey = new Map<string, Entry>();
let done = 0;
async function worker() {
  for (let date = queue.shift(); date !== undefined; date = queue.shift()) {
    for (const e of await fetchDay(date)) {
      const key = `${e.code}|${e.validFromDate.slice(0, 10)}`;
      if (!byKey.has(key)) byKey.set(key, e);
    }
    done++;
    if (done % 50 === 0) process.stdout.write(`${done} days\n`);
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

const rates = [...byKey.values()]
  .map((e) => ({
    currency: e.code,
    validFrom: e.validFromDate.slice(0, 10),
    rate: e.rateFormated,
    quantity: e.quantity,
    setAt: e.date,
  }))
  .sort((a, b) =>
    a.validFrom === b.validFrom
      ? a.currency.localeCompare(b.currency)
      : a.validFrom.localeCompare(b.validFrom),
  );
const lines = rates.map((r) => `    ${JSON.stringify(r)}`).join(',\n');
await writeFile(
  OUT,
  `{\n  "source": "${ENDPOINT}",\n  "recordedOn": "${tbilisiToday}",\n  "requestedFrom": "${from}",\n  "requestedTo": "${to}",\n  "rates": [\n${lines}\n  ]\n}\n`,
);
process.stdout.write(`${rates.length} rates written to ${OUT}\n`);
