// Filed monthly returns (declaration_filings). Insert-only: the database rejects UPDATE, DELETE
// and TRUNCATE (0004_declarations.sql). A refiling inserts a correction with version + 1.
import { and, asc, desc, eq, gte, lte, sql } from 'drizzle-orm';
import type { DbOrTx, Tx } from '../client';
import { declarationFilings, users } from '../schema/index';

export type DeclarationFilingRow = typeof declarationFilings.$inferSelect;
export type NewDeclarationFiling = Omit<
  typeof declarationFilings.$inferInsert,
  'id' | 'orgId' | 'filedAt'
>;

export interface DeclarationFilingWithFiler extends DeclarationFilingRow {
  filer: { id: string; name: string; email: string };
}

const withFiler = {
  filing: declarationFilings,
  filer: { id: users.id, name: users.name, email: users.email },
};

/** Every filing of `period`, newest (highest version) first. */
export async function listFilings(
  db: DbOrTx,
  orgId: string,
  period: string,
): Promise<DeclarationFilingWithFiler[]> {
  const rows = await db
    .select(withFiler)
    .from(declarationFilings)
    .innerJoin(users, eq(users.id, declarationFilings.filedBy))
    .where(and(eq(declarationFilings.orgId, orgId), eq(declarationFilings.period, period)))
    .orderBy(desc(declarationFilings.version));
  return rows.map((r) => ({ ...r.filing, filer: r.filer }));
}

/** The latest filing of each period of `year` that has one, keyed by period. One query. */
export async function latestFilingsForYear(
  db: DbOrTx,
  orgId: string,
  year: number,
): Promise<Map<string, DeclarationFilingRow>> {
  const y = String(year).padStart(4, '0');
  const rows = await db
    .selectDistinctOn([declarationFilings.period])
    .from(declarationFilings)
    .where(
      and(
        eq(declarationFilings.orgId, orgId),
        gte(declarationFilings.period, `${y}-01`),
        lte(declarationFilings.period, `${y}-12`),
      ),
    )
    .orderBy(asc(declarationFilings.period), desc(declarationFilings.version));
  return new Map(rows.map((r) => [r.period.trim(), r]));
}

/**
 * Serialises filings of one org period for the rest of the transaction, so two concurrent
 * filings cannot both see the same "latest" version. The unique (org, period, version) index
 * backs this up.
 */
export async function lockFilingPeriod(tx: Tx, orgId: string, period: string): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`declaration:${orgId}:${period}`}, 0))`,
  );
}

export async function insertFiling(
  tx: Tx,
  orgId: string,
  values: NewDeclarationFiling,
): Promise<DeclarationFilingWithFiler> {
  const [row] = await tx
    .insert(declarationFilings)
    .values({ ...values, orgId })
    .returning();
  if (!row) throw new Error('declaration filing insert returned no row');
  const [filer] = await tx.select(withFiler.filer).from(users).where(eq(users.id, row.filedBy));
  if (!filer) throw new Error('filer missing after insert');
  return { ...row, filer };
}
