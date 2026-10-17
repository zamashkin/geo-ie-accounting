// Clients (WS-09): the people and companies an org invoices.
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type { DbOrTx, Tx } from '../client';
import { clients, invoicePayments, invoices } from '../schema/index';

export type ClientRow = typeof clients.$inferSelect;
export type NewClient = Omit<
  typeof clients.$inferInsert,
  'id' | 'orgId' | 'createdAt' | 'updatedAt' | 'archivedAt'
>;
export type ClientPatch = Partial<NewClient> & { archivedAt?: Date | null };

/** Clients of an org by name. Archived ones only when asked for. */
export async function listClients(
  db: DbOrTx,
  orgId: string,
  opts: { includeArchived?: boolean } = {},
): Promise<ClientRow[]> {
  return db
    .select()
    .from(clients)
    .where(
      and(eq(clients.orgId, orgId), opts.includeArchived ? undefined : isNull(clients.archivedAt)),
    )
    .orderBy(asc(sql`lower(${clients.name})`), asc(clients.id));
}

export async function getClient(
  db: DbOrTx,
  orgId: string,
  clientId: string,
  opts: { forUpdate?: boolean } = {},
): Promise<ClientRow | null> {
  const query = db
    .select()
    .from(clients)
    .where(and(eq(clients.orgId, orgId), eq(clients.id, clientId)));
  const [row] = opts.forUpdate ? await query.for('update') : await query;
  return row ?? null;
}

export async function createClient(tx: Tx, orgId: string, values: NewClient): Promise<ClientRow> {
  const [row] = await tx
    .insert(clients)
    .values({ ...values, orgId })
    .returning();
  if (!row) throw new Error('client insert returned no row');
  return row;
}

export async function updateClient(
  tx: Tx,
  orgId: string,
  clientId: string,
  patch: ClientPatch,
): Promise<ClientRow> {
  const [row] = await tx
    .update(clients)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(clients.orgId, orgId), eq(clients.id, clientId)))
    .returning();
  if (!row) throw new Error('client update returned no row');
  return row;
}

export interface ClientInvoiceStats {
  clientId: string;
  /** Issued, paid and void invoices. */
  invoiceCount: number;
  overdueCount: number;
  /** Outstanding on issued invoices per currency, zero amounts left out. */
  outstanding: { currency: string; amountMinor: bigint }[];
}

/**
 * Per client: how many invoices were issued and what the issued ones still owe, per currency.
 * One aggregated statement. `clientId` narrows it to one client.
 */
export async function clientInvoiceStats(
  db: DbOrTx,
  orgId: string,
  today: string,
  opts: { clientId?: string } = {},
): Promise<Map<string, ClientInvoiceStats>> {
  const result = await db.execute<{
    client_id: string;
    currency: string;
    invoice_count: string;
    overdue_count: string;
    outstanding: string;
  }>(sql`
    with paid as (
      select invoice_id, sum(amount_minor) as paid
      from ${invoicePayments}
      where org_id = ${orgId}
      group by invoice_id
    )
    select i.client_id, i.currency,
      count(*) filter (where i.status <> 'draft') as invoice_count,
      count(*) filter (where i.status = 'issued' and i.due_date < ${today}) as overdue_count,
      coalesce(sum(greatest(i.total_minor - coalesce(p.paid, 0), 0))
        filter (where i.status = 'issued'), 0) as outstanding
    from ${invoices} i
    left join paid p on p.invoice_id = i.id
    where i.org_id = ${orgId} ${opts.clientId ? sql`and i.client_id = ${opts.clientId}` : sql``}
    group by i.client_id, i.currency
    order by i.client_id, i.currency
  `);
  const stats = new Map<string, ClientInvoiceStats>();
  for (const r of result.rows) {
    const entry = stats.get(r.client_id) ?? {
      clientId: r.client_id,
      invoiceCount: 0,
      overdueCount: 0,
      outstanding: [],
    };
    entry.invoiceCount += Number(r.invoice_count);
    entry.overdueCount += Number(r.overdue_count);
    const amount = BigInt(r.outstanding);
    if (amount !== 0n) entry.outstanding.push({ currency: r.currency, amountMinor: amount });
    stats.set(r.client_id, entry);
  }
  return stats;
}
