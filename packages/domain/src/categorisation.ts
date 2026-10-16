import type { CurrencyCode } from './currency';

// Categorisation rules for imported statement lines (WS-07). Pure matching: the API loads the
// org's rules and the parsed rows and stores which rule suggested which account.

/** `in`: money arrived (positive amount). `out`: money left (negative amount). */
export type RuleDirection = 'in' | 'out';

/** The conditions of a rule. Every condition that is set must hold; unset ones match anything. */
export interface RuleConditions {
  /** Case-insensitive substring of the counterparty name. */
  readonly counterpartyContains: string | null;
  /** Case-insensitive substring of the bank's description. */
  readonly descriptionContains: string | null;
  readonly direction: RuleDirection | null;
  readonly currency: CurrencyCode | null;
  /** Inclusive bounds on the absolute amount, in minor units of `currency`. */
  readonly amountMinMinor: bigint | null;
  readonly amountMaxMinor: bigint | null;
}

export interface CategorisationRule extends RuleConditions {
  readonly id: string;
  /** Lower runs first. Ties keep the input order. */
  readonly priority: number;
  readonly isActive: boolean;
  readonly targetAccountId: string;
}

/** The fields of a parsed statement line a rule can look at. */
export interface RuleSubject {
  readonly counterparty: string | null;
  readonly description: string;
  /** Signed, as on the statement. */
  readonly amountMinor: bigint;
  readonly currency: CurrencyCode;
}

/** Lower case, whitespace runs collapsed: bank exports pad and wrap names inconsistently. */
function normalise(text: string): string {
  return text.toLocaleLowerCase('en-US').replace(/\s+/g, ' ').trim();
}

function contains(haystack: string | null, needle: string | null): boolean {
  if (needle === null) return true;
  const n = normalise(needle);
  if (n === '') return true;
  return haystack !== null && normalise(haystack).includes(n);
}

/** True when every condition the rule sets holds for the line. Ignores `isActive`. */
export function ruleMatches(rule: RuleConditions, line: RuleSubject): boolean {
  if (rule.currency !== null && rule.currency !== line.currency) return false;
  if (rule.direction === 'in' && line.amountMinor <= 0n) return false;
  if (rule.direction === 'out' && line.amountMinor >= 0n) return false;
  const magnitude = line.amountMinor < 0n ? -line.amountMinor : line.amountMinor;
  if (rule.amountMinMinor !== null && magnitude < rule.amountMinMinor) return false;
  if (rule.amountMaxMinor !== null && magnitude > rule.amountMaxMinor) return false;
  return (
    contains(line.counterparty, rule.counterpartyContains) &&
    contains(line.description, rule.descriptionContains)
  );
}

/** A rule with no condition at all would catch every line; the API refuses to store one. */
export function hasAnyCondition(rule: RuleConditions): boolean {
  return (
    (rule.counterpartyContains !== null && normalise(rule.counterpartyContains) !== '') ||
    (rule.descriptionContains !== null && normalise(rule.descriptionContains) !== '') ||
    rule.direction !== null ||
    rule.currency !== null ||
    rule.amountMinMinor !== null ||
    rule.amountMaxMinor !== null
  );
}

/**
 * The first active rule, by priority, that matches the line and that `usable` accepts (the
 * caller rejects rules whose account cannot take the line, e.g. archived or another currency).
 * Returns null when none does; the fixed suggestions apply then.
 */
export function findMatchingRule<R extends CategorisationRule>(
  rules: readonly R[],
  line: RuleSubject,
  usable: (rule: R) => boolean = () => true,
): R | null {
  const ordered = rules
    .map((rule, index) => ({ rule, index }))
    .sort((a, b) => a.rule.priority - b.rule.priority || a.index - b.index);
  for (const { rule } of ordered) {
    if (rule.isActive && ruleMatches(rule, line) && usable(rule)) return rule;
  }
  return null;
}
