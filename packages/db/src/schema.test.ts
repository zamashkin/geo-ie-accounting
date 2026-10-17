import { INCOME_CLASSES, PAYMENT_METHODS, ROLES, SYSTEM_ACCOUNT_KEYS } from '@ie-ledger/contracts';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CHART_OF_ACCOUNTS } from './chart-of-accounts';
import * as schema from './schema/index';

describe('schema', () => {
  it('builds pg enums from the contracts values', () => {
    expect(schema.roleEnum.enumValues).toEqual([...ROLES]);
    expect(schema.paymentMethodEnum.enumValues).toEqual([...PAYMENT_METHODS]);
    expect(schema.incomeClassEnum.enumValues).toEqual([...INCOME_CLASSES]);
  });

  it('stores every money column as bigint', () => {
    const moneyColumns = [
      schema.postings.amountMinor,
      schema.postings.gelAmountMinor,
      schema.importRows.amountMinor,
      schema.declarationFilings.taxGelMinor,
      schema.declarationFilings.ytdGelMinor,
      schema.invoiceLines.unitPriceMinor,
    ];
    for (const col of moneyColumns) {
      expect(col.getSQLType()).toBe('bigint');
      expect(col.dataType).toBe('bigint');
    }
  });

  it('gives every tenant table an org_id column', () => {
    const global = new Set([
      'users',
      'auth_sessions',
      'auth_accounts',
      'auth_verifications',
      'organizations',
      'exchange_rates',
    ]);
    const tables = Object.values(schema)
      .filter((v): v is typeof schema.accounts => typeof v === 'object' && 'getSQL' in v)
      .map((t) => getTableConfig(t));
    expect(tables.length).toBe(24);
    for (const t of tables.filter((t) => !global.has(t.name))) {
      expect(
        t.columns.some((c) => c.name === 'org_id'),
        `${t.name} has org_id`,
      ).toBe(true);
    }
  });
});

describe('default chart of accounts', () => {
  it('classifies every income account and only income accounts', () => {
    for (const a of DEFAULT_CHART_OF_ACCOUNTS) {
      expect(a.incomeClass !== null, a.name).toBe(a.kind === 'income');
    }
  });

  it('has each system account exactly once', () => {
    const keys = DEFAULT_CHART_OF_ACCOUNTS.map((a) => a.systemKey).filter(Boolean);
    expect([...keys].sort()).toEqual([...SYSTEM_ACCOUNT_KEYS].sort());
  });

  it('has at least one SBS income account', () => {
    expect(DEFAULT_CHART_OF_ACCOUNTS.some((a) => a.incomeClass === 'sbs')).toBe(true);
  });
});
