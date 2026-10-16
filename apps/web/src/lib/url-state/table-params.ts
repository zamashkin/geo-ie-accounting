import type { z } from 'zod';

// Table state in the URL (ARCHITECTURE §9: "filters in URL search params"), so a filtered,
// sorted list can be bookmarked, shared and restored with Back.
//
//   ?sort=-occurredOn&q=acme&account=…&cursor=…
//
// `sort` is one column id, `-` prefix = descending (server sorts on one key). Filters are
// plain params described by a Zod object schema. `cursor` is the opaque API cursor.

export interface ColumnSort {
  id: string;
  desc: boolean;
}

export interface TableParams<F> {
  sorting: ColumnSort[];
  filters: F;
  cursor: string | null;
}

export interface TableParamsDefinition<F extends Record<string, unknown>> {
  /** Filter params; every field optional or defaulted. Values arrive as strings. */
  filters: z.ZodType<F, Record<string, string | string[] | undefined>>;
  /** Column ids the server can sort on. Anything else in the URL is ignored. */
  sortable: readonly string[];
  defaultSort?: ColumnSort;
}

/** Defines a table's URL params once, next to its columns. */
export function defineTableParams<F extends Record<string, unknown>>(
  definition: TableParamsDefinition<F>,
): TableParamsDefinition<F> {
  return definition;
}

const RESERVED = new Set(['sort', 'cursor']);

export function decodeSort(
  raw: string | null,
  def: Pick<TableParamsDefinition<never>, 'sortable' | 'defaultSort'>,
): ColumnSort[] {
  if (raw) {
    const desc = raw.startsWith('-');
    const id = desc ? raw.slice(1) : raw;
    if (def.sortable.includes(id)) return [{ id, desc }];
  }
  return def.defaultSort ? [def.defaultSort] : [];
}

export function encodeSort(sorting: readonly ColumnSort[]): string | null {
  const first = sorting[0];
  return first ? `${first.desc ? '-' : ''}${first.id}` : null;
}

/** URLSearchParams → typed state. Invalid filters fall back to their defaults, never throw. */
export function parseTableParams<F extends Record<string, unknown>>(
  params: URLSearchParams,
  def: TableParamsDefinition<F>,
): TableParams<F> {
  const raw: Record<string, string | string[]> = {};
  for (const key of new Set(params.keys())) {
    if (RESERVED.has(key)) continue;
    const all = params.getAll(key);
    raw[key] = all.length > 1 ? all : (all[0] ?? '');
  }
  let filters = def.filters.safeParse(raw);
  if (!filters.success) {
    // Drop the offending keys one by one rather than losing every filter.
    const bad = new Set(filters.error.issues.map((i) => String(i.path[0])));
    filters = def.filters.safeParse(
      Object.fromEntries(Object.entries(raw).filter(([k]) => !bad.has(k))),
    );
  }
  return {
    sorting: decodeSort(params.get('sort'), def),
    filters: filters.success ? filters.data : def.filters.parse({}),
    cursor: params.get('cursor') || null,
  };
}

/**
 * State → query string (no leading `?`). Empty values are omitted; the default sort is not
 * written, so the plain URL stays clean.
 */
export function serializeTableParams<F extends Record<string, unknown>>(
  state: TableParams<F>,
  def: Pick<TableParamsDefinition<F>, 'defaultSort'>,
): string {
  const out = new URLSearchParams();
  const sort = encodeSort(state.sorting);
  const defaultSort = def.defaultSort ? encodeSort([def.defaultSort]) : null;
  if (sort && sort !== defaultSort) out.set('sort', sort);
  for (const [key, value] of Object.entries(state.filters)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value))
      value.forEach((v) => {
        out.append(key, String(v));
      });
    else if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
      out.set(key, String(value));
  }
  if (state.cursor) out.set('cursor', state.cursor);
  return out.toString();
}

/** Applies a change. Changing sort or filters starts again from the first page. */
export function updateTableParams<F extends Record<string, unknown>>(
  current: TableParams<F>,
  patch: Partial<TableParams<F>>,
): TableParams<F> {
  const resetsCursor = patch.sorting !== undefined || patch.filters !== undefined;
  return {
    sorting: patch.sorting ?? current.sorting,
    filters: patch.filters ?? current.filters,
    cursor: patch.cursor !== undefined ? patch.cursor : resetsCursor ? null : current.cursor,
  };
}
