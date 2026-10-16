'use client';

import type { Route } from 'next';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo, useTransition } from 'react';
import {
  parseTableParams,
  serializeTableParams,
  type TableParams,
  type TableParamsDefinition,
  updateTableParams,
} from './table-params';

/**
 * Table state backed by the URL. Updates use `router.replace` (no history entry per
 * keystroke, no scroll jump) inside a transition, so the current rows stay visible while the
 * server component or query for the new params loads.
 *
 *   const [params, setParams, isPending] = useTableParams(transactionParams);
 *   <DataTable sorting={params.sorting} onSortingChange={(sorting) => setParams({ sorting })} />
 */
export function useTableParams<F extends Record<string, unknown>>(
  definition: TableParamsDefinition<F>,
): [TableParams<F>, (patch: Partial<TableParams<F>>) => void, boolean] {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const state = useMemo(
    () => parseTableParams(new URLSearchParams(searchParams.toString()), definition),
    [searchParams, definition],
  );

  const setState = useCallback(
    (patch: Partial<TableParams<F>>) => {
      const next = updateTableParams(state, patch);
      const query = serializeTableParams(next, definition);
      startTransition(() => {
        router.replace(`${pathname}${query ? `?${query}` : ''}` as Route, { scroll: false });
      });
    },
    [state, definition, pathname, router],
  );

  return [state, setState, isPending];
}
