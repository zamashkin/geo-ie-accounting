// `pnpm db:seed:demo` end to end on a fresh database, with "today" pinned: the story the demo
// promises is there, the demo login can read it and change nothing, a re-run is a no-op.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cookieFrom, startApiTestEnv, WEB_ORIGIN, type ApiTestEnv } from '../testing/env';
import { DEMO_LOGIN } from './profile';
import { DemoRates } from './rates';
import { seedDemoWorkspaces, type SeedDemoResult } from './seed';

const AS_OF = '2026-10-17';

let env: ApiTestEnv;
let result: SeedDemoResult;
let cookie: string;

beforeAll(async () => {
  env = await startApiTestEnv({
    demo: { enabled: true },
    now: () => new Date(`${AS_OF}T08:00:00Z`),
  });
  result = await seedDemoWorkspaces({ db: env.tdb.db, asOf: AS_OF, rates: DemoRates.load(null) });
  const res = await env.app.inject({
    method: 'POST',
    url: '/v1/auth/sign-in/email',
    headers: { origin: WEB_ORIGIN },
    payload: { email: DEMO_LOGIN.email, password: DEMO_LOGIN.password },
  });
  cookie = cookieFrom(res);
}, 120_000);

afterAll(async () => {
  await (env as ApiTestEnv | undefined)?.close();
});

const get = async <T>(url: string) =>
  (await env.app.inject({ method: 'GET', url, headers: { cookie } })).json<T>();

describe('demo seed', () => {
  it('builds both workspaces and gives the demo login viewer access', async () => {
    expect(result.workspaces.map((w) => w.name)).toEqual([
      'Demo: IT freelancer',
      'Demo: high earner',
    ]);
    const me = await get<{ user: { readOnly: boolean }; memberships: { role: string }[] }>(
      '/v1/me',
    );
    expect(me.user.readOnly).toBe(true);
    expect(me.memberships.map((m) => m.role)).toEqual(['viewer', 'viewer']);
  });

  it('tells the story: filed, corrected, drifted, overdue, 3% after the limit', async () => {
    type Year = {
      months: {
        period: string;
        rateBp: number;
        status: { kind: string };
        latestFiling: { version: number } | null;
      }[];
    };
    const [freelancer, highEarner] = result.workspaces.map((w) => w.orgId);
    const y2026 = await get<Year>(`/v1/orgs/${freelancer}/declarations?year=2026`);
    const status = (p: string) => y2026.months.find((m) => m.period === p);
    expect(status('2026-02')).toMatchObject({
      status: { kind: 'filed' },
      latestFiling: { version: 2 },
    });
    expect(status('2026-06')?.status.kind).toBe('filed_with_drift');
    expect(status('2026-09')?.status.kind).toBe('overdue');
    expect(y2026.months.filter((m) => m.status.kind === 'filed_with_drift')).toHaveLength(1);

    const high = await get<Year>(`/v1/orgs/${highEarner}/declarations?year=2025`);
    expect(high.months.some((m) => m.rateBp > 100)).toBe(true);

    const invoices = await get<{
      items: { status: string; overdue: boolean; paidMinor: string }[];
    }>(`/v1/orgs/${freelancer}/invoices?limit=200`);
    const kinds = new Set(invoices.items.map((i) => (i.overdue ? 'overdue' : i.status)));
    expect([...kinds].sort()).toEqual(['draft', 'issued', 'overdue', 'paid', 'void']);
    expect(invoices.items.some((i) => i.status === 'issued' && i.paidMinor !== '0')).toBe(true);
  });

  it('does nothing on a second run for the same day', async () => {
    const again = await seedDemoWorkspaces({
      db: env.tdb.db,
      asOf: AS_OF,
      rates: DemoRates.load(null),
    });
    expect(again.unchanged).toBe(true);
    expect(again.workspaces.map((w) => w.orgId).sort()).toEqual(
      result.workspaces.map((w) => w.orgId).sort(),
    );
  });
});
