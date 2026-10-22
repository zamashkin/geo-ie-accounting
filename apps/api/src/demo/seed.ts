// `pnpm db:seed:demo` (ADR 0016): builds the public demo workspaces by driving the real API in
// process, as their owner would through the web app: create the workspace, set up accounts,
// rules and clients, issue invoices, upload Bank of Georgia statements, commit them, match
// payments, file the monthly returns, reverse a mistake. Every booking goes through the routes,
// so the domain builders, ledger triggers, audit log and idempotency all apply.
//
// The API clock is moved through the year, so filings and invoices carry plausible dates. The
// output depends only on the profiles, the recorded NBG rates and `asOf` ("today").
import { randomBytes, randomUUID } from 'node:crypto';
import {
  Account,
  AccountList,
  CategorizationRule,
  ClientView,
  CommitImportResponse,
  DeclarationFiling,
  ImportRowList,
  InvoiceView,
  OrganizationWithRole,
  TransactionView,
  UploadStatementResponse,
} from '@geo-ie-accounting/contracts';
import {
  listDemoOrganizations,
  markDemoOrganization,
  removeOtherMemberships,
  retireDemoOrganization,
  setMembership,
  upsertPasswordLogin,
  upsertRates,
  type Db,
} from '@geo-ie-accounting/db';
import {
  addDays,
  BASE_CURRENCY,
  deadlineFor,
  firstDayOf,
  nextPeriod,
  periodOf,
  type IsoDate,
  type Period,
} from '@geo-ie-accounting/domain';
import type { z } from 'zod';
import { buildApp, type App } from '../app';
import {
  lastDayOf,
  monthName,
  nthWeekday,
  onOrAfterWeekday,
  periodsBetween,
  previousPeriod,
  weekdayFrom,
  isWeekday,
} from './calendar';
import {
  CURRENCIES,
  planMonth,
  refundLine,
  type BookAs,
  type ExpectedPayment,
  type PlannedLine,
} from './month';
import {
  DEMO_AUTHOR,
  DEMO_GENERATOR_VERSION,
  DEMO_LOGIN,
  DEMO_WORKSPACES,
  type DemoClient,
  type DemoWorkspace,
} from './profile';
import { random } from './random';
import type { DemoRates } from './rates';
import { renderBogCsv } from './statement';

const ORIGIN = 'http://demo-seed.invalid';

export interface SeedDemoOptions {
  db: Db;
  /** "Today" in Tbilisi: data runs up to the day before. */
  asOf: IsoDate;
  rates: DemoRates;
  /** Rebuild even when the workspaces were made by the same generator for the same day. */
  force?: boolean;
  log?: (message: string) => void;
}

export interface SeededWorkspace {
  name: string;
  orgId: string;
  transactions: number;
  imports: number;
  invoices: number;
  filings: number;
}

export interface SeedDemoResult {
  /** True when the existing workspaces were already up to date. */
  unchanged: boolean;
  workspaces: SeededWorkspace[];
  retired: number;
}

/** The marker stored in `organizations.demo_seed`. */
export const demoSeedMarker = (ws: DemoWorkspace, asOf: IsoDate) =>
  `${ws.key}:v${DEMO_GENERATOR_VERSION}:${asOf}`;

export async function seedDemoWorkspaces(opts: SeedDemoOptions): Promise<SeedDemoResult> {
  const { db, asOf, rates } = opts;
  const log = opts.log ?? (() => undefined);

  const stored = await upsertRates(db, rates.rows());
  log(`NBG rates: ${stored.inserted} added, ${stored.unchanged} already stored.`);

  const viewerId = await upsertPasswordLogin(db, { ...DEMO_LOGIN, readOnly: true });
  const authorPassword = () => randomBytes(24).toString('base64url');
  await upsertPasswordLogin(db, { ...DEMO_AUTHOR, password: authorPassword(), readOnly: false });

  const existing = await listDemoOrganizations(db);
  const wanted = new Set(DEMO_WORKSPACES.map((ws) => demoSeedMarker(ws, asOf)));
  if (
    !opts.force &&
    existing.length === wanted.size &&
    existing.every((o) => wanted.has(o.demoSeed))
  ) {
    for (const o of existing) await setMembership(db, o.id, viewerId, 'viewer');
    await removeOtherMemberships(
      db,
      viewerId,
      existing.map((o) => o.id),
    );
    return {
      unchanged: true,
      retired: 0,
      workspaces: existing.map((o) => ({
        name: o.name,
        orgId: o.id,
        transactions: 0,
        imports: 0,
        invoices: 0,
        filings: 0,
      })),
    };
  }
  // The ledger is insert-only, so old demo workspaces are retired (no members), not deleted.
  for (const o of existing) {
    await retireDemoOrganization(db, o.id, `${o.name} (retired ${asOf})`);
  }

  const clock = { date: asOf };
  const app = await buildApp(
    {
      version: 'demo-seed',
      webOrigin: ORIGIN,
      logger: false,
      auth: { baseUrl: ORIGIN, rateLimit: false },
    },
    {
      db,
      checkDatabase: () => Promise.resolve(true),
      // Noon in Tbilisi on the simulated day.
      ledger: { rates, now: () => new Date(`${clock.date}T08:00:00.000Z`) },
    },
  );
  try {
    const password = authorPassword();
    await upsertPasswordLogin(db, { ...DEMO_AUTHOR, password, readOnly: false });
    const signIn = await app.inject({
      method: 'POST',
      url: '/v1/auth/sign-in/email',
      headers: { origin: ORIGIN },
      payload: { email: DEMO_AUTHOR.email, password },
    });
    if (signIn.statusCode !== 200) throw new Error(`demo author sign-in failed: ${signIn.body}`);
    const raw = signIn.headers['set-cookie'];
    const cookie = (Array.isArray(raw) ? raw : raw ? [raw] : [])
      .map((c) => c.split(';')[0])
      .join('; ');
    const api = new DemoApi(app, cookie);

    const workspaces: SeededWorkspace[] = [];
    for (const ws of DEMO_WORKSPACES) {
      const seeded = await new WorkspaceSeeder(api, ws, asOf, rates, clock, log).run();
      await markDemoOrganization(db, seeded.orgId, demoSeedMarker(ws, asOf));
      await setMembership(db, seeded.orgId, viewerId, 'viewer');
      workspaces.push(seeded);
    }
    await removeOtherMemberships(
      db,
      viewerId,
      workspaces.map((w) => w.orgId),
    );
    await api.send('POST', '/v1/auth/sign-out', {});
    // Nobody keeps the password the seed signed in with.
    await upsertPasswordLogin(db, { ...DEMO_AUTHOR, password: authorPassword(), readOnly: false });
    return { unchanged: false, retired: existing.length, workspaces };
  } finally {
    await app.close();
  }
}

// ── A browser-like API client ───────────────────────────────────────────────────────────

class DemoApi {
  constructor(
    private readonly app: App,
    private readonly cookie: string,
  ) {}

  async send(
    method: 'GET' | 'POST' | 'PATCH',
    url: string,
    payload?: unknown,
    headers: Record<string, string> = {},
  ): Promise<unknown> {
    const res = await this.app.inject({
      method,
      url,
      headers: {
        origin: ORIGIN,
        cookie: this.cookie,
        ...(method === 'GET' ? {} : { 'idempotency-key': randomUUID() }),
        ...headers,
      },
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });
    if (res.statusCode >= 400) {
      throw new Error(`${method} ${url}: HTTP ${res.statusCode} ${res.body}`);
    }
    return res.body.length > 0 ? (JSON.parse(res.body) as unknown) : null;
  }

  async get<S extends z.ZodType>(schema: S, url: string): Promise<z.output<S>> {
    return schema.parse(await this.send('GET', url));
  }

  async post<S extends z.ZodType>(schema: S, url: string, body: unknown): Promise<z.output<S>> {
    return schema.parse(await this.send('POST', url, body));
  }

  async upload(url: string, file: Buffer, fileName: string) {
    const boundary = `----geo-ie-accounting-demo-${randomUUID()}`;
    const payload = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\n` +
          'Content-Type: text/csv\r\n\r\n',
      ),
      file,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const res = await this.app.inject({
      method: 'POST',
      url,
      payload,
      headers: {
        origin: ORIGIN,
        cookie: this.cookie,
        'idempotency-key': randomUUID(),
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
    });
    if (res.statusCode >= 400)
      throw new Error(`upload ${fileName}: HTTP ${res.statusCode} ${res.body}`);
    return UploadStatementResponse.parse(JSON.parse(res.body) as unknown);
  }
}

// ── One workspace ───────────────────────────────────────────────────────────────────────

const monthsBefore = (period: Period, n: number) => {
  let p = period;
  for (let i = 0; i < n; i++) p = previousPeriod(p);
  return p;
};
const minDate = (a: IsoDate, b: IsoDate) => (a < b ? a : b);

class WorkspaceSeeder {
  private orgId = '';
  private readonly accounts = new Map<string, string>();
  private readonly bankAccounts = new Map<string, string>();
  private readonly clients = new Map<string, string>();
  private readonly payments: ExpectedPayment[] = [];
  private balances = new Map<string, bigint>();
  private readonly tax = new Map<Period, bigint>();
  private readonly filings = new Map<Period, string>();
  private readonly deferred: {
    period: Period;
    currency: string;
    opening: bigint;
    lines: PlannedLine[];
  }[] = [];
  private refund: { transactionId: string; date: IsoDate } | null = null;
  private seq = 0;
  private readonly stats = { transactions: 0, imports: 0, invoices: 0, filings: 0 };

  // Relative to "today": L is the last month that has ended, A the current one.
  private readonly A: Period;
  private readonly L: Period;
  private readonly unfiled: Set<Period>;
  private readonly story: {
    lateImport: Period;
    drift: Period;
    voided: Period;
    cash: Period;
  } | null;

  constructor(
    private readonly api: DemoApi,
    private readonly ws: DemoWorkspace,
    private readonly asOf: IsoDate,
    private readonly rates: DemoRates,
    private readonly clock: { date: IsoDate },
    private readonly log: (m: string) => void,
  ) {
    this.A = periodOf(asOf);
    this.L = previousPeriod(this.A);
    // The last month is "due" while its deadline is ahead; then the month before is overdue.
    // Past the deadline the last month itself is the overdue one.
    const due = deadlineFor(this.L) >= asOf;
    this.unfiled = new Set(ws.storyline && due ? [this.L, previousPeriod(this.L)] : [this.L]);
    const first = periodOf(ws.startsOn);
    const story = {
      lateImport: monthsBefore(this.L, 7),
      drift: monthsBefore(this.L, 3),
      voided: monthsBefore(this.L, 6),
      cash: monthsBefore(this.L, 5),
    };
    this.story =
      ws.storyline && story.lateImport > periodOf(ws.sbsEffectiveFrom) && story.lateImport > first
        ? story
        : null;
  }

  private at(date: IsoDate) {
    this.clock.date = minDate(date, this.asOf);
  }

  private orgUrl(path: string) {
    return `/v1/orgs/${this.orgId}${path}`;
  }

  private account(key: BookAs): string | null {
    if (key === 'unassigned') return null;
    const id = this.accounts.get(key);
    if (!id) throw new Error(`demo account ${key} missing`);
    return id;
  }

  async run(): Promise<SeededWorkspace> {
    const { ws } = this;
    this.at(ws.startsOn);
    await this.setUp();
    for (const period of periodsBetween(periodOf(ws.startsOn), this.A)) {
      await this.issueInvoices(period);
      if (period < this.A) await this.closeMonth(period);
      else await this.currentMonth(period);
    }
    if (this.story) await this.draftForNextMonth();
    this.log(
      `${ws.name}: ${this.stats.transactions} transactions from ${this.stats.imports} imports, ` +
        `${this.stats.invoices} invoices, ${this.stats.filings} filings.`,
    );
    return { name: ws.name, orgId: this.orgId, ...this.stats };
  }

  // ── Setup: workspace, accounts, rules, clients ────────────────────────────────────────

  private async setUp() {
    const { ws, api } = this;
    const org = await api.post(OrganizationWithRole, '/v1/orgs', {
      name: ws.name,
      taxId: ws.taxId,
    });
    this.orgId = org.id;
    await api.send('PATCH', this.orgUrl(''), {
      sbsEffectiveFrom: ws.sbsEffectiveFrom,
      address: ws.address,
      email: ws.email,
      phone: ws.phone,
      invoicePrefix: ws.invoicePrefix,
      invoiceDueDays: 14,
      invoiceNote: ws.invoiceNote,
    });

    const { items } = await api.get(AccountList, this.orgUrl('/accounts'));
    const named = new Map(items.map((a) => [a.name, a.id]));
    const system = new Map(
      items.flatMap((a) => (a.systemKey ? [[a.systemKey, a.id] as const] : [])),
    );
    const need = (map: Map<string, string>, key: string) => {
      const id = map.get(key);
      if (!id) throw new Error(`default account ${key} missing`);
      return id;
    };
    this.accounts.set('sbs_income', need(named, 'Income: Services'));
    this.accounts.set('interest', need(named, 'Income: Interest'));
    this.accounts.set('bank_fees', need(named, 'Expenses: Bank Fees'));
    this.accounts.set('fx_clearing', need(system, 'fx_clearing'));
    this.accounts.set('tax_payable', need(system, 'tax_payable'));
    this.accounts.set('owner_equity', need(system, 'owner_equity'));

    // The real Bank of Georgia accounts replace the default unnamed ones.
    for (const a of items) {
      if (a.kind === 'asset' && a.currency && !a.systemKey && !a.iban) {
        await api.send('PATCH', this.orgUrl(`/accounts/${a.id}`), { archived: true });
      }
    }
    for (const currency of CURRENCIES) {
      const created = await api.post(Account, this.orgUrl('/accounts'), {
        name: `Bank of Georgia ${currency}`,
        kind: 'asset',
        currency,
        bank: 'bog',
        iban: ws.iban,
      });
      this.bankAccounts.set(currency, created.id);
    }
    for (const [key, name] of [
      ['software', 'Expenses: Software & services'],
      ['coworking', 'Expenses: Coworking'],
    ] as const) {
      const created = await api.post(Account, this.orgUrl('/accounts'), { name, kind: 'expense' });
      this.accounts.set(key, created.id);
    }
    if (this.story) {
      const cash = await api.post(Account, this.orgUrl('/accounts'), {
        name: 'Cash GEL',
        kind: 'asset',
        currency: BASE_CURRENCY,
      });
      this.bankAccounts.set('cash', cash.id);
    }

    const rule = (body: Record<string, unknown>) =>
      api.post(CategorizationRule, this.orgUrl('/rules'), body);
    await rule({
      name: 'Bank service fee',
      descriptionContains: 'service fee',
      direction: 'out',
      targetAccountId: this.account('bank_fees'),
    });
    await rule({
      name: 'Small-business tax to the Treasury',
      descriptionContains: 'Treasury transfer',
      direction: 'out',
      currency: BASE_CURRENCY,
      targetAccountId: this.account('tax_payable'),
    });
    await rule({
      name: 'Owner draws to my personal card',
      descriptionContains: 'own card',
      direction: 'out',
      targetAccountId: this.account('owner_equity'),
    });
    await rule({
      name: 'Software and cloud subscriptions',
      descriptionContains: 'Card payment',
      direction: 'out',
      targetAccountId: this.account('software'),
    });
    await rule({
      name: 'Coworking membership',
      descriptionContains: 'coworking',
      direction: 'out',
      currency: BASE_CURRENCY,
      targetAccountId: this.account('coworking'),
    });

    for (const c of ws.clients) {
      const created = await api.post(ClientView, this.orgUrl('/clients'), {
        name: c.name,
        country: c.country,
        defaultCurrency: c.currency,
        address: c.address,
        email: c.email,
        notes: 'Fictional client for the demo.',
      });
      this.clients.set(c.key, created.id);
    }
  }

  // ── Invoices ──────────────────────────────────────────────────────────────────────────

  private scale(minor: bigint, period: Period) {
    return (minor * this.ws.scalePct(Number(period.slice(0, 4)))) / 100n;
  }

  private linesFor(c: DemoClient, period: Period, rng: ReturnType<typeof random>) {
    const worked = monthName(previousPeriod(period));
    const b = c.billing;
    switch (b.kind) {
      case 'retainer':
        return [
          {
            description: `${b.line}, ${worked}`,
            quantity: '1',
            unitPriceMinor: this.scale(
              b.baseMinor + rng.bigint(-b.jitterMinor, b.jitterMinor),
              period,
            ),
          },
        ];
      case 'hourly': {
        const halfHours = rng.int(b.minHours * 2, b.maxHours * 2);
        return [
          {
            description: `${b.line}, ${worked}`,
            quantity: halfHours % 2 === 0 ? String(halfHours / 2) : `${(halfHours - 1) / 2}.5`,
            unitPriceMinor: this.scale(b.rateMinor, period),
          },
        ];
      }
      case 'project':
        return [
          {
            description: `${rng.pick(b.features)} (fixed price)`,
            quantity: '1',
            unitPriceMinor: (this.scale(rng.bigint(b.minMinor, b.maxMinor), period) / 100n) * 100n,
          },
          {
            description: 'Deployment and handover support, hours',
            quantity: String(rng.int(2, 8)),
            unitPriceMinor: this.scale(b.hourlyMinor, period),
          },
        ];
    }
  }

  /** Creates and issues one invoice; returns it with its frozen total and number. */
  private async issue(
    c: DemoClient,
    lines: { description: string; quantity: string; unitPriceMinor: bigint }[],
    issueDate: IsoDate,
  ) {
    this.at(issueDate);
    const draft = await this.api.post(InvoiceView, this.orgUrl('/invoices'), {
      clientId: this.clients.get(c.key),
      currency: c.currency,
      bankAccountId: this.bankAccounts.get(c.currency),
      lines: lines.map((l) => ({ ...l, unitPriceMinor: l.unitPriceMinor.toString() })),
    });
    const issued = await this.api.post(InvoiceView, this.orgUrl(`/invoices/${draft.id}/issue`), {
      issueDate,
    });
    this.stats.invoices++;
    return issued;
  }

  private expect(
    c: DemoClient,
    invoice: z.output<typeof InvoiceView>,
    amountMinor: bigint,
    date: IsoDate,
  ) {
    if (!invoice.number) throw new Error('issued invoice without a number');
    this.payments.push({
      invoiceId: invoice.id,
      number: invoice.number,
      clientKey: c.key,
      sender: c.sender,
      currency: c.currency,
      amountMinor,
      date: onOrAfterWeekday(date),
    });
  }

  private async issueInvoices(period: Period) {
    const { ws } = this;
    for (const c of ws.clients) {
      if (c.from > period) continue;
      const rng = random(`${ws.key}|${period}|${c.key}|invoice`);
      const overdueStory = this.story !== null && period === this.L && c.key === 'lumen';
      const partialStory = this.story !== null && period === this.L && c.key === 'bluefjord';
      const { billing } = c;
      const project = billing.kind === 'project';
      if (billing.kind === 'project' && !rng.chance(billing.chance) && !overdueStory) continue;

      let issueDate =
        project && !overdueStory
          ? weekdayFrom(period, rng.int(8, 22))
          : nthWeekday(period, rng.int(1, 3));
      if (issueDate < ws.startsOn) issueDate = onOrAfterWeekday(ws.startsOn);
      if (issueDate >= this.asOf || periodOf(issueDate) !== period) continue;
      const lines = this.linesFor(c, period, rng);

      if (this.story && period === this.story.voided && c.key === 'halcyon') {
        // A typo in the amount: issued, spotted, voided and replaced the same day.
        const wrong = await this.issue(
          c,
          lines.map((l) => ({ ...l, unitPriceMinor: l.unitPriceMinor * 10n })),
          issueDate,
        );
        await this.api.post(InvoiceView, this.orgUrl(`/invoices/${wrong.id}/void`), {
          reason: 'Typo in the amount; replaced by the next invoice.',
        });
      }

      const invoice = await this.issue(c, lines, issueDate);
      if (overdueStory) continue; // never paid: overdue
      if (partialStory) {
        // Half now, the rest still owed.
        this.expect(c, invoice, (invoice.totalMinor / 2n / 100n) * 100n, addDays(issueDate, 6));
        continue;
      }
      const [min, max] = c.payAfterDays;
      this.expect(c, invoice, invoice.totalMinor, addDays(issueDate, rng.int(min, max)));
    }

    // This month: one invoice sent a few days ago, not due yet.
    if (this.story && period === this.A) {
      let date = addDays(this.asOf, -2);
      while (!isWeekday(date)) date = addDays(date, -1);
      const lumen = ws.clients.find((c) => c.key === 'lumen');
      if (lumen && periodOf(date) === period && date >= ws.startsOn) {
        await this.issue(
          lumen,
          this.linesFor(lumen, period, random(`${ws.key}|${period}|open`)),
          date,
        );
      }
    }
  }

  private async draftForNextMonth() {
    const halcyon = this.ws.clients.find((c) => c.key === 'halcyon');
    if (!halcyon) return;
    const next = nextPeriod(this.A);
    this.at(this.asOf);
    await this.api.post(InvoiceView, this.orgUrl('/invoices'), {
      clientId: this.clients.get(halcyon.key),
      currency: halcyon.currency,
      bankAccountId: this.bankAccounts.get(halcyon.currency),
      notes: 'Draft: send on the 1st.',
      lines: this.linesFor(halcyon, next, random(`${this.ws.key}|${next}|draft`)).map((l) => ({
        ...l,
        unitPriceMinor: l.unitPriceMinor.toString(),
      })),
    });
    this.stats.invoices++;
  }

  // ── Statements ────────────────────────────────────────────────────────────────────────

  private async plan(period: Period) {
    const rng = random(`${this.ws.key}|${period}|bank`);
    const prev = previousPeriod(period);
    const taxPeriodFiled = this.filings.has(prev) ? (this.tax.get(prev) ?? 0n) : 0n;
    const extra: PlannedLine[] = [];
    if (this.story && period === this.story.drift) {
      const date = weekdayFrom(period, 9);
      extra.push(
        await refundLine(
          this.ws,
          date,
          this.rates,
          `PMI${date.replaceAll('-', '').slice(2)}990001`,
        ),
      );
    }
    const { lines, balances } = await planMonth({
      ws: this.ws,
      period,
      asOf: this.asOf,
      rng,
      rates: this.rates,
      balances: this.balances,
      payments: this.payments,
      taxToPay: taxPeriodFiled > 0n ? { period: prev, amountMinor: taxPeriodFiled } : null,
      extra,
      docSeq: { next: () => ++this.seq },
    });
    this.balances = balances;
    return lines;
  }

  /** Uploads one statement, fixes the rows the rules got wrong, and optionally commits. */
  private async importStatement(
    period: Period,
    currency: string,
    opening: bigint,
    lines: PlannedLine[],
    commit: boolean,
  ) {
    if (lines.length === 0) return;
    const first = firstDayOf(period);
    const from = first < this.ws.startsOn ? this.ws.startsOn : first;
    const to = minDate(lastDayOf(period), addDays(this.asOf, -1));
    const closing = lines.reduce((s, l) => s + l.amountMinor, opening);
    const csv = renderBogCsv({
      ownerName: this.ws.statementOwner,
      clientCode: this.ws.bankClientCode,
      iban: this.ws.iban,
      currency,
      from,
      to,
      openingMinor: opening,
      openingRate: await this.balanceRate(currency, opening, from),
      closingRate: await this.balanceRate(currency, closing, to),
      lines,
    });
    const upload = await this.api.upload(
      this.orgUrl('/imports'),
      Buffer.from(csv, 'utf8'),
      `statement_${this.ws.iban}${currency}_${period}.csv`,
    );
    this.stats.imports++;
    const batch = upload.batch.id;
    const rows = await this.api.get(ImportRowList, this.orgUrl(`/imports/${batch}/rows?limit=200`));
    for (const row of rows.items) {
      const line = lines[row.rowIndex];
      if (!line) throw new Error(`statement row ${row.rowIndex} has no planned line`);
      const want = this.account(line.bookAs);
      if (row.status === 'new' && row.accountId !== want) {
        await this.api.send('PATCH', this.orgUrl(`/imports/${batch}/rows/${row.id}`), {
          accountId: want,
        });
      }
    }
    if (!commit) return;
    const committed = await this.api.post(
      CommitImportResponse,
      this.orgUrl(`/imports/${batch}/commit`),
      {},
    );
    this.stats.transactions += committed.transactionIds.length;
    const booked = await this.api.get(
      ImportRowList,
      this.orgUrl(`/imports/${batch}/rows?limit=200`),
    );
    for (const row of booked.items) {
      const line = lines[row.rowIndex];
      if (!line || !row.transactionId) continue;
      if (line.invoiceId) {
        await this.api.post(InvoiceView, this.orgUrl(`/invoices/${line.invoiceId}/match-payment`), {
          transactionId: row.transactionId,
          amountMinor: line.amountMinor.toString(),
        });
      }
      if (line.refund) this.refund = { transactionId: row.transactionId, date: line.date };
    }
  }

  private async balanceRate(currency: string, balance: bigint, date: IsoDate) {
    if (currency === BASE_CURRENCY) return { rate: '1.0000', gelMinor: balance };
    const r = await this.rates.rateOn(currency, date);
    return { rate: r.rate, gelMinor: await this.rates.gelOn(currency, balance, date) };
  }

  private async importMonth(period: Period, opts: { previewGel: boolean }) {
    const openings = new Map(this.balances);
    const lines = await this.plan(period);
    for (const currency of CURRENCIES) {
      const list = lines.get(currency) ?? [];
      const opening = openings.get(currency) ?? 0n;
      if (this.story && period === this.story.lateImport && currency === 'EUR') {
        // Forgotten until next month: the filing misses it and gets corrected.
        this.deferred.push({ period, currency, opening, lines: list });
        continue;
      }
      if (currency === BASE_CURRENCY && opts.previewGel) {
        let date = addDays(this.asOf, -1);
        while (!isWeekday(date)) date = addDays(date, -1);
        if (periodOf(date) === period && date >= this.ws.startsOn) {
          list.push({
            currency,
            date,
            doc: `OUT${date.replaceAll('-', '').slice(2)}990002`,
            loro: 'GE00TR0000000000000002',
            amountMinor: -8_500n,
            rate: '1.0000',
            gelMinor: 8_500n,
            description: 'Transfer to EXAMPLE PRINT HOUSE LLC: business cards',
            bookAs: 'unassigned',
            order: 4,
          });
        }
        await this.importStatement(period, currency, opening, list, false);
        continue;
      }
      await this.importStatement(period, currency, opening, list, true);
    }
  }

  // ── Month end: import, corrections, filing ────────────────────────────────────────────

  private async closeMonth(period: Period) {
    const next = nextPeriod(period);
    this.at(nthWeekday(next, 1));
    // Added when the first interest line shows up, like a user would.
    if (['03', '06', '09', '12'].includes(period.slice(5, 7)) && !this.interestRule) {
      await this.api.post(CategorizationRule, this.orgUrl('/rules'), {
        name: 'Savings interest (not small-business income)',
        descriptionContains: 'Interest accrued',
        direction: 'in',
        currency: BASE_CURRENCY,
        targetAccountId: this.account('interest'),
      });
      this.interestRule = true;
    }
    // Last month's forgotten statement turns up: import it, then file the corrected return.
    for (const late of this.deferred.splice(0)) {
      await this.importStatement(late.period, late.currency, late.opening, late.lines, true);
      const previous = this.filings.get(late.period);
      if (previous) await this.file(late.period, nthWeekday(next, 2), previous);
    }
    this.at(nthWeekday(next, 2));
    await this.importMonth(period, { previewGel: false });

    if (this.story && period === this.story.cash) await this.cashReceipt(period);
    // Spotted a month after filing: the filed month now differs from its return.
    if (this.story && period === nextPeriod(this.story.drift)) await this.correctRefund();

    const sbsFrom = periodOf(this.ws.sbsEffectiveFrom);
    if (period >= sbsFrom && !this.unfiled.has(period)) {
      const rng = random(`${this.ws.key}|${period}|filing`);
      await this.file(period, weekdayFrom(next, rng.int(5, 10)), null);
    }
  }

  private interestRule = false;

  private async file(period: Period, on: IsoDate, supersedesId: string | null) {
    this.at(on);
    const rng = random(`${this.ws.key}|${period}|rs|${supersedesId ?? ''}`);
    const filing = await this.api.post(
      DeclarationFiling,
      this.orgUrl(`/declarations/${period}/file`),
      { rsReference: `RS-${period.replace('-', '')}-${rng.int(100000, 999999)}`, supersedesId },
    );
    this.filings.set(period, filing.id);
    this.tax.set(period, filing.figures.taxGelMinor);
    this.stats.filings++;
  }

  private async currentMonth(period: Period) {
    this.at(this.asOf);
    await this.importMonth(period, { previewGel: this.story !== null });
  }

  // ── The storyline's hand-made bookings ─────────────────────────────────────────────────

  private async cashReceipt(period: Period) {
    const cash = this.bankAccounts.get('cash');
    if (!cash) return;
    const received = weekdayFrom(period, 18);
    this.stats.transactions += 2;
    await this.api.post(TransactionView, this.orgUrl('/transactions'), {
      type: 'income',
      occurredOn: received,
      description: 'Workshop fee, paid in cash (Tbilisi developer meetup)',
      bankAccountId: cash,
      incomeAccountId: this.account('sbs_income'),
      amountMinor: '60000',
      paymentMethod: 'other',
    });
    await this.api.post(TransactionView, this.orgUrl('/transactions'), {
      type: 'owner_draw',
      occurredOn: addDays(received, 3),
      description: 'Workshop cash taken for personal use',
      bankAccountId: cash,
      amountMinor: '60000',
    });
  }

  /**
   * The refund was booked as income by the default suggestion and the month was filed. Reverse
   * it (same date, so the filed month now differs from its filing) and book it as what it is:
   * money back on an expense.
   */
  private async correctRefund() {
    const refund = this.refund;
    if (!refund) return;
    await this.api.post(
      TransactionView,
      this.orgUrl(`/transactions/${refund.transactionId}/reverse`),
      {
        description: 'Reversal: supplier refund booked as income by mistake',
      },
    );
    await this.api.post(TransactionView, this.orgUrl('/transactions'), {
      type: 'postings',
      occurredOn: refund.date,
      description: 'CloudNine Hosting: refund of a duplicate charge (not income)',
      paymentMethod: null,
      postings: [
        { accountId: this.bankAccounts.get('USD'), amountMinor: '12000', currency: 'USD' },
        { accountId: this.account('software'), amountMinor: '-12000', currency: 'USD' },
      ],
    });
    this.stats.transactions += 2;
  }
}
