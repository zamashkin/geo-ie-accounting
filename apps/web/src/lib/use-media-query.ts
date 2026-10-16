'use client';

import { useCallback, useSyncExternalStore } from 'react';

/** Below Tailwind's `sm` breakpoint (40rem = 640px). */
export const NARROW_SCREEN = '(max-width: 39.99rem)';

/**
 * Whether a CSS media query matches, kept in sync as the viewport changes. The server and the
 * first client render report `serverValue` (wide by default), so hydration never mismatches.
 */
export function useMediaQuery(query: string, serverValue = false): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => {
        list.removeEventListener('change', onChange);
      };
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => serverValue,
  );
}
