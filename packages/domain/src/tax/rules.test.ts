import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { InvalidDateError, NoRuleSetError } from '../errors';
import { latestRuleSet, ruleSetFor, TAX_RULE_SETS } from './rules';
import type { TaxRuleSet } from './rules';

describe('TAX_RULE_SETS', () => {
  it('is sorted by effectiveFrom, with version = effectiveFrom and no duplicates', () => {
    const dates = TAX_RULE_SETS.map((s) => s.effectiveFrom);
    expect([...dates].sort()).toEqual(dates);
    expect(new Set(dates).size).toBe(dates.length);
    for (const set of TAX_RULE_SETS) expect(set.version).toBe(set.effectiveFrom);
  });

  it('cites a source and a confidence for every value', () => {
    for (const set of TAX_RULE_SETS) {
      for (const [key, value] of Object.entries(set)) {
        if (key === 'version' || key === 'effectiveFrom') continue;
        const sourced = value as { source: unknown; confidence: unknown };
        expect(sourced.source, `${set.version}.${key}`).toEqual(expect.any(String));
        expect(['primary', 'secondary'], `${set.version}.${key}`).toContain(sourced.confidence);
      }
    }
  });

  it('keeps the primary rules from SPEC §2.1 in every set', () => {
    for (const set of TAX_RULE_SETS) {
      expect(set.baseRateBp).toMatchObject({
        value: 100,
        source: 'TaxCode Art.90(1)',
        confidence: 'primary',
      });
      expect(set.increasedRateBp).toMatchObject({
        value: 300,
        source: 'TaxCode Art.90(2)',
        confidence: 'primary',
      });
      expect(set.annualLimitGelMinor).toMatchObject({ value: 50_000_000n, confidence: 'primary' });
      expect(set.increasedRateFrom.value).toBe('month_of_crossing');
      expect(set.consecutiveYearsOverLimitForRevocation.value).toBe(2);
      expect(set.filingDeadlineDayOfNextMonth).toMatchObject({
        value: 15,
        source: 'TaxCode Art.93(11)',
      });
      expect(set.lossesCarriedForward.value).toBe(false);
    }
  });
});

describe('ruleSetFor across effectiveFrom boundaries', () => {
  // date, version, return layout, status start, records retention (years)
  const TABLE: [
    string,
    string,
    TaxRuleSet['returnLayout']['value'],
    TaxRuleSet['statusStart']['value'],
    number,
  ][] = [
    ['2024-01-01', '2024-01-01', 'before_2024_12', 'first_of_next_month', 6],
    ['2024-11-30', '2024-01-01', 'before_2024_12', 'first_of_next_month', 6],
    ['2024-12-01', '2024-12-01', 'lines_15_18_21', 'first_of_next_month', 6],
    ['2026-02-28', '2024-12-01', 'lines_15_18_21', 'first_of_next_month', 6],
    ['2026-03-01', '2026-03-01', 'lines_15_18_21', 'application_date', 3],
    ['2026-10-15', '2026-03-01', 'lines_15_18_21', 'application_date', 3],
    ['2099-12-31', '2026-03-01', 'lines_15_18_21', 'application_date', 3],
  ];

  it.each(TABLE)('%s → %s', (date, version, layout, statusStart, retention) => {
    const set = ruleSetFor(date);
    expect(set.version).toBe(version);
    expect(set.returnLayout.value).toBe(layout);
    expect(set.statusStart.value).toBe(statusStart);
    expect(set.recordsRetentionYears.value).toBe(retention);
  });

  it('has no rules before the first set', () => {
    expect(() => ruleSetFor('2023-12-31')).toThrow(NoRuleSetError);
    expect(() => ruleSetFor('2023-12-31')).toThrow(
      expect.objectContaining({ code: 'no_rule_set' }),
    );
  });

  it('validates the date', () => {
    expect(() => ruleSetFor('2026-02-30')).toThrow(InvalidDateError);
  });

  it('works with a custom, unsorted table (e.g. a future limit change)', () => {
    const base = ruleSetFor('2026-10-15');
    const raised: TaxRuleSet = {
      ...base,
      version: '2027-01-01',
      effectiveFrom: '2027-01-01',
      annualLimitGelMinor: { value: 70_000_000n, source: 'hypothetical', confidence: 'secondary' },
    };
    const sets = [raised, ...TAX_RULE_SETS];
    expect(ruleSetFor('2026-12-31', sets).version).toBe('2026-03-01');
    expect(ruleSetFor('2027-01-01', sets).annualLimitGelMinor.value).toBe(70_000_000n);
    expect(latestRuleSet(sets)).toBe(raised);
  });

  it('latestRuleSet needs at least one set', () => {
    expect(latestRuleSet().version).toBe('2026-03-01');
    expect(() => latestRuleSet([])).toThrow(NoRuleSetError);
  });
});

describe('rule values live only in rules.ts (CLAUDE.md)', () => {
  const srcDir = path.resolve(import.meta.dirname, '..');
  const sources = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return sources(full);
      return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [full] : [];
    });

  it('no other source file mentions the GEL 500,000 limit', () => {
    for (const file of sources(srcDir)) {
      if (file.endsWith(path.join('tax', 'rules.ts'))) continue;
      const text = readFileSync(file, 'utf8');
      expect(text, file).not.toMatch(/50_?000_?000n|500_?000\b|\b0\.0[13]\b/);
    }
  });
});
