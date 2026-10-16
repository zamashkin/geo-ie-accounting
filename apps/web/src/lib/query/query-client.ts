import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { isApiError } from '../api/errors';

/** Retry only what can succeed on retry: network failures and 5xx, at most twice. */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= 2) return false;
  if (!isApiError(error)) return false;
  return error.kind === 'network' || error.status >= 500;
}

export interface QueryClientOptions {
  /** Called when any query or mutation fails with 401 (session expired). */
  onUnauthenticated?: () => void;
}

export function makeQueryClient({ onUnauthenticated }: QueryClientOptions = {}): QueryClient {
  const handle = (error: unknown) => {
    if (isApiError(error) && error.code === 'unauthenticated') onUnauthenticated?.();
  };
  return new QueryClient({
    queryCache: new QueryCache({ onError: handle }),
    mutationCache: new MutationCache({ onError: handle }),
    defaultOptions: {
      queries: {
        // Server components render the first view; client queries refresh in the background.
        staleTime: 30_000,
        retry: shouldRetry,
        refetchOnWindowFocus: true,
      },
      mutations: { retry: false },
    },
  });
}
