import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  decodeSort,
  defineTableParams,
  parseTableParams,
  serializeTableParams,
  updateTableParams,
} from './table-params';

const transactions = defineTableParams({
  filters: z.object({
    q: z.string().optional(),
    account: z.uuid().optional(),
    source: z
      .array(z.enum(['manual', 'import', 'reversal']))
      .or(z.enum(['manual', 'import', 'reversal']).transform((s) => [s]))
      .optional(),
    from: z.iso.date().optional(),
  }),
  sortable: ['occurredOn', 'amount'],
  defaultSort: { id: 'occurredOn', desc: true },
});

const ACCOUNT = '0199e8a0-0000-7000-8000-000000000001';

describe('decodeSort', () => {
  it('reads a descending sort', () => {
    expect(decodeSort('-amount', transactions)).toEqual([{ id: 'amount', desc: true }]);
  });

  it('ignores columns the server cannot sort on', () => {
    expect(decodeSort('password', transactions)).toEqual([{ id: 'occurredOn', desc: true }]);
  });
});

describe('parseTableParams', () => {
  it('parses sort, filters and cursor', () => {
    const p = new URLSearchParams(
      `sort=amount&q=acme&account=${ACCOUNT}&source=import&source=manual&cursor=abc`,
    );
    expect(parseTableParams(p, transactions)).toEqual({
      sorting: [{ id: 'amount', desc: false }],
      filters: { q: 'acme', account: ACCOUNT, source: ['import', 'manual'] },
      cursor: 'abc',
    });
  });

  it('drops only the invalid filter', () => {
    const p = new URLSearchParams('q=acme&account=not-a-uuid&from=2026-13-40');
    expect(parseTableParams(p, transactions).filters).toEqual({ q: 'acme' });
  });

  it('falls back to defaults for an empty URL', () => {
    expect(parseTableParams(new URLSearchParams(), transactions)).toEqual({
      sorting: [{ id: 'occurredOn', desc: true }],
      filters: {},
      cursor: null,
    });
  });
});

describe('serializeTableParams', () => {
  it('omits defaults and empty values', () => {
    expect(
      serializeTableParams(
        {
          sorting: [{ id: 'occurredOn', desc: true }],
          filters: { q: '', account: undefined },
          cursor: null,
        },
        transactions,
      ),
    ).toBe('');
  });

  it('round-trips', () => {
    const state = {
      sorting: [{ id: 'amount', desc: true }],
      filters: { q: 'Upwork Global', source: ['import' as const, 'manual' as const] },
      cursor: 'c2',
    };
    const query = serializeTableParams(state, transactions);
    expect(query).toBe('sort=-amount&q=Upwork+Global&source=import&source=manual&cursor=c2');
    expect(parseTableParams(new URLSearchParams(query), transactions)).toEqual(state);
  });
});

describe('updateTableParams', () => {
  const current = { sorting: [], filters: { q: 'a' }, cursor: 'c3' };

  it('resets the cursor when filters change', () => {
    expect(updateTableParams(current, { filters: { q: 'b' } }).cursor).toBeNull();
  });

  it('resets the cursor when sorting changes', () => {
    expect(
      updateTableParams(current, { sorting: [{ id: 'amount', desc: false }] }).cursor,
    ).toBeNull();
  });

  it('keeps everything else when only the cursor moves', () => {
    expect(updateTableParams(current, { cursor: 'c4' })).toEqual({ ...current, cursor: 'c4' });
  });
});
