import { z } from 'zod';
import { CategorizationRule } from './entities';
import { RuleDirection } from './enums';
import { ImportRowView } from './ledger';
import { CurrencyCode, MinorUnits, Uuid } from './primitives';
import { OrgParams } from './tenancy';

// Categorisation rules (WS-07) under /v1/orgs/:orgId/rules, and the import preview actions
// that use them: re-apply rules, bulk row edits.

export const RuleParams = OrgParams.extend({ ruleId: Uuid });
export type RuleParams = z.output<typeof RuleParams>;

/** Empty text means "any": sent as null or "", stored as null. */
const TextCondition = z
  .string()
  .trim()
  .max(200)
  .nullable()
  .optional()
  .transform((v) => (v === '' ? null : v));

/** Rule fields a client sends. At least one condition must be set. */
const RuleFields = {
  name: z.string().trim().min(1, 'Name the rule').max(200),
  counterpartyContains: TextCondition,
  descriptionContains: TextCondition,
  direction: RuleDirection.nullable().optional(),
  currency: CurrencyCode.nullable().optional(),
  /** Inclusive, on the absolute amount, in minor units of `currency` (required with a bound). */
  amountMinMinor: MinorUnits.nullable().optional(),
  amountMaxMinor: MinorUnits.nullable().optional(),
  /** The account a matching line is booked against. Its kind gives the income class. */
  targetAccountId: Uuid,
  isActive: z.boolean().optional(),
};

/** `POST /rules`: appended after the existing rules (lowest priority). */
export const CreateRuleRequest = z.object(RuleFields).meta({ id: 'CreateRuleRequest' });
export type CreateRuleRequest = z.output<typeof CreateRuleRequest>;

/** `PATCH /rules/:ruleId`: only the fields sent change; null clears a condition. */
export const UpdateRuleRequest = z.object(RuleFields).partial().meta({ id: 'UpdateRuleRequest' });
export type UpdateRuleRequest = z.output<typeof UpdateRuleRequest>;

/** `GET /rules`: in priority order, the order they are tried in. Not paginated. */
export const RuleList = z.object({ items: z.array(CategorizationRule) }).meta({ id: 'RuleList' });
export type RuleList = z.output<typeof RuleList>;

/** `POST /rules/reorder`: every rule id of the org, in the new order (first is tried first). */
export const ReorderRulesRequest = z
  .object({ ruleIds: z.array(Uuid).max(1000) })
  .meta({ id: 'ReorderRulesRequest' });
export type ReorderRulesRequest = z.output<typeof ReorderRulesRequest>;

// ── Import preview actions ──────────────────────────────────────────────────────────────

/**
 * `POST /imports/:batchId/apply-rules`: recomputes the suggestion of every row the user has not
 * edited (no chosen account, not a duplicate) with the current rules, then the fixed
 * suggestions. `updated` counts rows whose suggestion changed.
 */
export const ApplyRulesResponse = z
  .object({ updated: z.int().nonnegative(), rows: z.array(ImportRowView) })
  .meta({ id: 'ApplyRulesResponse' });
export type ApplyRulesResponse = z.output<typeof ApplyRulesResponse>;

/**
 * `POST /imports/:batchId/rows/bulk`: the same change as `PATCH .../rows/:rowId` on several rows
 * at once. Duplicate rows are never booked and are left as they are.
 */
export const BulkUpdateImportRowsRequest = z
  .object({
    rowIds: z.array(Uuid).min(1).max(1000),
    accountId: Uuid.nullable().optional(),
    skip: z.boolean().optional(),
  })
  .refine((b) => b.accountId !== undefined || b.skip !== undefined, {
    message: 'Send accountId, skip or both',
  })
  .meta({ id: 'BulkUpdateImportRowsRequest' });
export type BulkUpdateImportRowsRequest = z.output<typeof BulkUpdateImportRowsRequest>;

export const BulkUpdateImportRowsResponse = z
  .object({
    /** The changed rows. */
    rows: z.array(ImportRowView),
    /** Ids that were left alone because they are duplicates. */
    ignored: z.array(Uuid),
  })
  .meta({ id: 'BulkUpdateImportRowsResponse' });
export type BulkUpdateImportRowsResponse = z.output<typeof BulkUpdateImportRowsResponse>;
