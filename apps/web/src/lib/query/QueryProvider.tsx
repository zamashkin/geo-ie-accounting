'use client';

import { QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { makeQueryClient } from './query-client';

function redirectToSignIn() {
  const next = `${window.location.pathname}${window.location.search}`;
  // A 401 means the session is gone: a full load drops all cached client state with it.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.assign(`/sign-in?next=${encodeURIComponent(next)}`);
}

/** One QueryClient per browser session (per request on the server, never shared). */
export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(() => makeQueryClient({ onUnauthenticated: redirectToSignIn }));
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
