'use client';

import { UiProvider } from '@geo-ie-accounting/ui';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { QueryProvider } from './query/QueryProvider';

/** Client-side providers for the whole app: data fetching, ui kit routing, toasts. */
export function AppProviders({ children }: { children: ReactNode }) {
  const router = useRouter();
  return (
    <QueryProvider>
      <UiProvider
        navigate={(href) => {
          router.push(href as Route);
        }}
      >
        {children}
      </UiProvider>
    </QueryProvider>
  );
}
