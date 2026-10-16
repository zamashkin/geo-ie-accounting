'use client';

import type { ReactNode } from 'react';
import { I18nProvider, RouterProvider } from 'react-aria-components';
import { DEFAULT_LOCALE } from '../../money/format';
import { Toaster } from '../toast/Toast';

export interface UiProviderProps {
  children: ReactNode;
  /**
   * Client-side navigation for React Aria links and menu items (e.g. Next's
   * `router.push`). Without it, links do full page loads.
   */
  navigate?: (href: string) => void;
  /** Maps an href to what the browser should see (e.g. adds a basePath). */
  useHref?: (href: string) => string;
  /** BCP 47 locale for dates and numbers. Default `en-GB` (day-month-year). */
  locale?: string;
}

/** App-wide setup for the kit: router integration, locale, and the toast region. */
export function UiProvider({
  children,
  navigate,
  useHref,
  locale = DEFAULT_LOCALE,
}: UiProviderProps) {
  const content = (
    <I18nProvider locale={locale}>
      {children}
      <Toaster />
    </I18nProvider>
  );
  if (!navigate) return content;
  return (
    <RouterProvider navigate={navigate} {...(useHref ? { useHref } : {})}>
      {content}
    </RouterProvider>
  );
}
