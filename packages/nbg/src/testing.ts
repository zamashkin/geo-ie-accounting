// Test helpers: a `fetch` that answers from the recorded responses in fixtures/nbg/ and never
// touches the network. Exported as `@ie-ledger/nbg/testing` for the worker and API tests.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const NBG_FIXTURES_DIR = fileURLToPath(new URL('../../../fixtures/nbg/', import.meta.url));

/** File name for a request, as written by scripts/record-fixtures.ts. */
export function fixtureName(url: URL): string {
  const codes = url.searchParams.getAll('currencies');
  return `${codes.join('-')}_${url.searchParams.get('date') ?? 'latest'}.json`;
}

export function readNbgFixture(name: string): unknown {
  return JSON.parse(readFileSync(`${NBG_FIXTURES_DIR}${name}`, 'utf8'));
}

export interface FixtureFetch {
  fetch: typeof globalThis.fetch;
  /** Every URL requested, in order. */
  calls: URL[];
}

/**
 * A fetch backed by fixtures/nbg/. A request with no recorded fixture fails the test loudly
 * instead of falling through to the network.
 */
export function createFixtureFetch(): FixtureFetch {
  const calls: URL[] = [];
  const fetch: typeof globalThis.fetch = (input) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    calls.push(url);
    let body: string;
    try {
      body = readFileSync(`${NBG_FIXTURES_DIR}${fixtureName(url)}`, 'utf8');
    } catch {
      return Promise.reject(new Error(`No NBG fixture for ${url.search} (${fixtureName(url)})`));
    }
    return Promise.resolve(
      new Response(body, { status: 200, headers: { 'content-type': 'application/json' } }),
    );
  };
  return { fetch, calls };
}
