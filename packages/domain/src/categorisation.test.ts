import { describe, expect, it } from 'vitest';
import {
  type CategorisationRule,
  findMatchingRule,
  hasAnyCondition,
  ruleMatches,
  type RuleSubject,
} from './categorisation';

const NONE = {
  counterpartyContains: null,
  descriptionContains: null,
  direction: null,
  currency: null,
  amountMinMinor: null,
  amountMaxMinor: null,
} as const;

const rule = (id: string, over: Partial<CategorisationRule> = {}): CategorisationRule => ({
  ...NONE,
  id,
  priority: 100,
  isActive: true,
  targetAccountId: `acc-${id}`,
  ...over,
});

const line: RuleSubject = {
  counterparty: '  ACME   Software LLC ',
  description: 'Invoice 2025-06 consulting',
  amountMinor: 118000n,
  currency: 'GBP',
};

describe('ruleMatches', () => {
  it('matches text case-insensitively, ignoring extra whitespace', () => {
    expect(ruleMatches({ ...NONE, counterpartyContains: 'acme software' }, line)).toBe(true);
    expect(ruleMatches({ ...NONE, descriptionContains: 'CONSULTING' }, line)).toBe(true);
    expect(ruleMatches({ ...NONE, counterpartyContains: 'globex' }, line)).toBe(false);
  });

  it('never matches a counterparty condition on a line without one', () => {
    expect(
      ruleMatches({ ...NONE, counterpartyContains: 'acme' }, { ...line, counterparty: null }),
    ).toBe(false);
  });

  it('checks direction from the sign', () => {
    expect(ruleMatches({ ...NONE, direction: 'in' }, line)).toBe(true);
    expect(ruleMatches({ ...NONE, direction: 'out' }, line)).toBe(false);
    expect(ruleMatches({ ...NONE, direction: 'out' }, { ...line, amountMinor: -500n })).toBe(true);
  });

  it('checks currency and an inclusive range on the absolute amount', () => {
    expect(ruleMatches({ ...NONE, currency: 'USD' }, line)).toBe(false);
    const range = { ...NONE, currency: 'GBP', amountMinMinor: 1000n, amountMaxMinor: 118000n };
    expect(ruleMatches(range, line)).toBe(true);
    expect(ruleMatches(range, { ...line, amountMinor: -118000n })).toBe(true);
    expect(ruleMatches(range, { ...line, amountMinor: 118001n })).toBe(false);
    expect(ruleMatches(range, { ...line, amountMinor: 999n })).toBe(false);
  });

  it('requires every condition that is set', () => {
    const both = { ...NONE, counterpartyContains: 'acme', direction: 'out' as const };
    expect(ruleMatches(both, line)).toBe(false);
    expect(ruleMatches({ ...both, direction: 'in' }, line)).toBe(true);
  });
});

describe('hasAnyCondition', () => {
  it('rejects a rule that would catch everything', () => {
    expect(hasAnyCondition(NONE)).toBe(false);
    expect(hasAnyCondition({ ...NONE, counterpartyContains: '   ' })).toBe(false);
    expect(hasAnyCondition({ ...NONE, direction: 'in' })).toBe(true);
  });
});

describe('findMatchingRule', () => {
  it('takes the lowest priority first, then input order', () => {
    const rules = [
      rule('late', { priority: 20, counterpartyContains: 'acme' }),
      rule('first-of-two', { priority: 10, direction: 'in' }),
      rule('second-of-two', { priority: 10, currency: 'GBP' }),
    ];
    expect(findMatchingRule(rules, line)?.id).toBe('first-of-two');
  });

  it('skips inactive rules and rules the caller cannot use', () => {
    const rules = [
      rule('off', { priority: 1, direction: 'in', isActive: false }),
      rule('archived-target', { priority: 2, direction: 'in' }),
      rule('ok', { priority: 3, direction: 'in' }),
    ];
    expect(findMatchingRule(rules, line, (r) => r.id !== 'archived-target')?.id).toBe('ok');
  });

  it('returns null when nothing matches', () => {
    expect(findMatchingRule([rule('x', { direction: 'out' })], line)).toBeNull();
    expect(findMatchingRule([], line)).toBeNull();
  });
});
