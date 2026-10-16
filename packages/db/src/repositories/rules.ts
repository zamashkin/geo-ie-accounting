// Categorisation rules (WS-07). Matching itself is packages/domain (findMatchingRule).
import { and, asc, eq, max } from 'drizzle-orm';
import type { DbOrTx, Tx } from '../client';
import { categorizationRules } from '../schema/index';

export type RuleRow = typeof categorizationRules.$inferSelect;
export type NewRule = Omit<
  typeof categorizationRules.$inferInsert,
  'id' | 'orgId' | 'createdAt' | 'updatedAt'
>;
export type RulePatch = Partial<Omit<NewRule, 'priority'>>;

/** Rules of an org in the order they are tried: priority, then age. */
export async function listRules(db: DbOrTx, orgId: string): Promise<RuleRow[]> {
  return db
    .select()
    .from(categorizationRules)
    .where(eq(categorizationRules.orgId, orgId))
    .orderBy(
      asc(categorizationRules.priority),
      asc(categorizationRules.createdAt),
      asc(categorizationRules.id),
    );
}

export async function getRule(
  db: DbOrTx,
  orgId: string,
  ruleId: string,
  opts: { forUpdate?: boolean } = {},
): Promise<RuleRow | null> {
  const query = db
    .select()
    .from(categorizationRules)
    .where(and(eq(categorizationRules.orgId, orgId), eq(categorizationRules.id, ruleId)));
  const [row] = opts.forUpdate ? await query.for('update') : await query;
  return row ?? null;
}

/** Inserts a rule after the org's existing ones unless a priority is given. */
export async function createRule(
  tx: Tx,
  orgId: string,
  values: Omit<NewRule, 'priority'> & { priority?: number },
): Promise<RuleRow> {
  let priority = values.priority;
  if (priority === undefined) {
    const [last] = await tx
      .select({ top: max(categorizationRules.priority) })
      .from(categorizationRules)
      .where(eq(categorizationRules.orgId, orgId));
    priority = (last?.top ?? -1) + 1;
  }
  const [row] = await tx
    .insert(categorizationRules)
    .values({ ...values, priority, orgId })
    .returning();
  if (!row) throw new Error('rule insert returned no row');
  return row;
}

export async function updateRule(
  tx: Tx,
  orgId: string,
  ruleId: string,
  patch: RulePatch,
): Promise<RuleRow> {
  const [row] = await tx
    .update(categorizationRules)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(categorizationRules.orgId, orgId), eq(categorizationRules.id, ruleId)))
    .returning();
  if (!row) throw new Error('rule update returned no row');
  return row;
}

/** Deletes a rule; import rows it suggested keep their account, their rule id becomes null. */
export async function deleteRule(tx: Tx, orgId: string, ruleId: string): Promise<boolean> {
  const rows = await tx
    .delete(categorizationRules)
    .where(and(eq(categorizationRules.orgId, orgId), eq(categorizationRules.id, ruleId)))
    .returning({ id: categorizationRules.id });
  return rows.length > 0;
}

/** Sets priority = position for every id, in one transaction. The caller checks the id set. */
export async function setRuleOrder(
  tx: Tx,
  orgId: string,
  ruleIds: readonly string[],
): Promise<void> {
  const now = new Date();
  for (const [priority, id] of ruleIds.entries()) {
    await tx
      .update(categorizationRules)
      .set({ priority, updatedAt: now })
      .where(and(eq(categorizationRules.orgId, orgId), eq(categorizationRules.id, id)));
  }
}
