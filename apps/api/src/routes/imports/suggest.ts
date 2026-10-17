// Suggested account of an import row: the first matching categorisation rule, else the fixed
// MVP suggestions (incoming payment → SBS income, conversion → FX Clearing), else none.
import type { OperationType } from '@ie-ledger/contracts';
import {
  getDefaultSbsIncomeAccount,
  getSystemAccount,
  listAccounts,
  listRules,
  type DbOrTx,
} from '@ie-ledger/db';
import { findMatchingRule } from '@ie-ledger/domain';

export interface SuggestableRow {
  counterparty: string | null;
  description: string;
  amountMinor: bigint;
  currency: string;
  operationType: OperationType;
}

export interface Suggestion {
  accountId: string | null;
  ruleId: string | null;
}

/** Loads the org's rules and accounts once; the returned function suggests per row. */
export async function loadSuggester(
  db: DbOrTx,
  orgId: string,
  bankAccountId: string,
): Promise<(row: SuggestableRow) => Suggestion> {
  // Sequential: `db` is often the request transaction, which runs one query at a time.
  const rules = await listRules(db, orgId);
  const accounts = await listAccounts(db, orgId);
  const sbsIncome = await getDefaultSbsIncomeAccount(db, orgId);
  const fxClearing = await getSystemAccount(db, orgId, 'fx_clearing');
  // Active accounts only: a rule pointing at an archived account is passed over.
  const active = new Map(accounts.map((a) => [a.id, a]));

  return (row) => {
    const rule = findMatchingRule(rules, row, (r) => {
      const target = active.get(r.targetAccountId);
      return (
        target !== undefined &&
        target.id !== bankAccountId &&
        (target.currency === null || target.currency === row.currency)
      );
    });
    if (rule) return { accountId: rule.targetAccountId, ruleId: rule.id };
    if (row.operationType === 'incoming_payment' && row.amountMinor > 0n && sbsIncome) {
      return { accountId: sbsIncome.id, ruleId: null };
    }
    if (row.operationType === 'fx_conversion' && fxClearing) {
      return { accountId: fxClearing.id, ruleId: null };
    }
    return { accountId: null, ruleId: null };
  };
}
