'use client';

import type { ThemePreference } from '@ie-ledger/ui';
import { useCallback, useSyncExternalStore } from 'react';

// Theme preference: system (default), light or dark. Stored per browser in localStorage and
// applied as <html data-theme>, which the ui tokens read. The inline script in the root
// layout applies it before first paint, so there is no flash of the wrong theme.

import { THEME_STORAGE_KEY } from './theme-script';

function read(): ThemePreference {
  try {
    const t = localStorage.getItem(THEME_STORAGE_KEY);
    return t === 'light' || t === 'dark' ? t : 'system';
  } catch {
    return 'system';
  }
}

const listeners = new Set<() => void>();

function apply(theme: ThemePreference) {
  try {
    if (theme === 'system') localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Private mode: the choice lasts for this page only.
  }
  if (theme === 'system') delete document.documentElement.dataset['theme'];
  else document.documentElement.dataset['theme'] = theme;
  listeners.forEach((l) => {
    l();
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useThemePreference(): [ThemePreference, (theme: ThemePreference) => void] {
  const theme = useSyncExternalStore(subscribe, read, () => 'system' as const);
  const set = useCallback((t: ThemePreference) => {
    apply(t);
  }, []);
  return [theme, set];
}
