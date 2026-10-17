// Records real NBG responses into fixtures/nbg/. Uses the live network: run by hand, never in tests.
//
//   pnpm --filter @geo-ie-accounting/nbg record-fixtures
//
// Bodies are written verbatim. fixtures/nbg/README.md explains what each case demonstrates.
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const ENDPOINT = 'https://nbg.gov.ge/gw/api/ct/monetarypolicy/currencies/en/json/';
const OUT = fileURLToPath(new URL('../../../fixtures/nbg/', import.meta.url));

interface Case {
  currencies: string[];
  date: string;
  /** Keep the given order instead of sorting (to record the ordering quirk). */
  unsorted?: boolean;
}

function days(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`);) {
    out.push(d.toISOString().slice(0, 10));
    d = new Date(d.getTime() + 86_400_000);
  }
  return out;
}

const cases: Case[] = [
  // 9-16 Oct 2026: weekdays, a weekend, the 14 Oct public holiday (Svetitskhovloba).
  ...days('2026-10-08', '2026-10-16').map((date) => ({ currencies: ['EUR', 'GBP', 'USD'], date })),
  // 8-15 Apr 2026: 9 Apr (National Unity Day), Orthodox Easter 10-13 Apr.
  ...days('2026-04-08', '2026-04-15').map((date) => ({ currencies: ['USD'], date })),
  // GBP rates the BoG statement fixture relies on.
  ...['2025-06-04', '2025-06-05', '2025-06-11'].map((date) => ({ currencies: ['GBP'], date })),
  // Currencies quoted per 1000 and per 100 units.
  { currencies: ['AMD', 'JPY', 'USD'], date: '2026-10-14' },
  // A code NBG does not publish: an empty array, HTTP 200.
  { currencies: ['XXX'], date: '2026-10-14' },
  // Unsorted codes: NBG answers [] for some orders (observed 2026-10-15).
  { currencies: ['USD', 'EUR'], date: '2026-10-14', unsorted: true },
];

await mkdir(OUT, { recursive: true });
for (const c of cases) {
  const codes = c.unsorted ? c.currencies : [...c.currencies].sort();
  const url = new URL(ENDPOINT);
  for (const code of codes) url.searchParams.append('currencies', code);
  url.searchParams.set('date', c.date);
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`${url.href} -> HTTP ${res.status}`);
  const body = await res.text();
  const name = `${c.unsorted ? 'unsorted_' : ''}${codes.join('-')}_${c.date}.json`;
  await writeFile(`${OUT}${name}`, `${JSON.stringify(JSON.parse(body), null, 2)}\n`);
  process.stdout.write(`${name}\n`);
}
