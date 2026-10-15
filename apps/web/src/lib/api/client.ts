import createClient from 'openapi-fetch';
import type { paths } from './schema.gen';

/** Typed client generated from apps/api/openapi.json (`pnpm gen:api`). */
export function createApiClient(baseUrl: string) {
  return createClient<paths>({ baseUrl });
}

export type ApiClient = ReturnType<typeof createApiClient>;
