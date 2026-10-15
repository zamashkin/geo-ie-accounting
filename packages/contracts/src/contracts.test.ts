import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  Declaration,
  JOB_NAMES,
  OrgEvent,
  ParsedRow,
  Problem,
  paginated,
  parseJobPayload,
  PaginationQuery,
  Posting,
} from './index';

const uuid = '0199e8a0-0000-7000-8000-000000000001';

describe('ParsedRow', () => {
  it('parses a BoG conversion row (FORMAT.md) with a counter-amount', () => {
    const row = ParsedRow.parse({
      rowIndex: 1,
      bookedOn: '2025-06-05',
      amountMinor: '-69085',
      currency: 'GBP',
      counterparty: null,
      counterpartyAccount: 'GE59BG0000000123456789USD',
      description: 'Payment - Amount GBP690.85; Foreign Exchange.',
      bankReference: '1234567890',
      documentNumber: '123',
      operationType: 'fx_conversion',
      bankOperationCode: 'CCO',
      bankGelAmountMinor: '-255255',
      counterAmountMinor: '90000',
      counterCurrency: 'USD',
      raw: { Date: 45813, ' Credit': null },
    });
    expect(row.amountMinor).toBe(-69085n);
    expect(row.counterAmountMinor).toBe(90000n);
    expect(row.bankGelAmountMinor).toBe(-255255n);
  });
});

describe('Posting', () => {
  it('serialises bigint amounts as strings', () => {
    const posting = Posting.parse({
      id: uuid,
      transactionId: uuid,
      orgId: uuid,
      accountId: uuid,
      amountMinor: '100000',
      currency: 'USD',
      gelAmountMinor: '271230',
      rateId: uuid,
    });
    const json = JSON.parse(JSON.stringify(z.encode(Posting, posting))) as Record<string, unknown>;
    expect(json.amountMinor).toBe('100000');
    expect(json.gelAmountMinor).toBe('271230');
  });
});

describe('Declaration', () => {
  it('carries rate in basis points and income by payment method', () => {
    const d = Declaration.parse({
      id: uuid,
      orgId: uuid,
      period: '2026-09',
      status: 'draft',
      turnoverGelMinor: '1000000',
      ytdGelMinor: '5000000',
      rateBp: 100,
      byPaymentMethod: { cash_register: '0', pos: '0', bank: '1000000', other: '0' },
      taxGelMinor: '10000',
      rulesVersion: '2024-01-01',
      snapshot: null,
      hasDrift: false,
      computedAt: '2026-10-15T10:00:00.000Z',
      filedAt: null,
      filedBy: null,
    });
    expect(d.byPaymentMethod.bank).toBe(1000000n);
  });
});

describe('jobs', () => {
  it('has a payload schema per job name', () => {
    expect(JOB_NAMES).toContain('noop');
    expect(JOB_NAMES).toContain('import.commit');
    expect(parseJobPayload('import.parse', { orgId: uuid, batchId: uuid })).toEqual({
      orgId: uuid,
      batchId: uuid,
    });
  });

  it('rejects invalid payloads', () => {
    expect(() => parseJobPayload('rates.backfill', { from: 'x', to: 'y' })).toThrow();
  });
});

describe('events', () => {
  it('discriminates on type', () => {
    const e = OrgEvent.parse({
      id: '1',
      at: '2026-10-15T10:00:00.000Z',
      type: 'import.progress',
      data: { batchId: uuid, phase: 'parse', processed: 10, total: 100 },
    });
    expect(e.type).toBe('import.progress');
    expect(OrgEvent.safeParse({ ...e, type: 'nope' }).success).toBe(false);
  });
});

describe('problem+json and pagination', () => {
  it('validates a problem document', () => {
    expect(
      Problem.safeParse({
        type: 'about:blank',
        title: 'Not Found',
        status: 404,
        code: 'not_found',
        requestId: 'req-1',
      }).success,
    ).toBe(true);
  });

  it('coerces and bounds the page limit', () => {
    expect(PaginationQuery.parse({ limit: '25' }).limit).toBe(25);
    expect(PaginationQuery.parse({}).limit).toBe(50);
    expect(PaginationQuery.safeParse({ limit: '1000' }).success).toBe(false);
    const page = paginated(z.string()).parse({ items: ['a'], nextCursor: null });
    expect(page.nextCursor).toBeNull();
  });
});
