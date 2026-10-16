import createClient, { type ClientOptions } from 'openapi-fetch';
import type { components, paths } from './schema.gen';

/** Typed client generated from apps/api/openapi.json (`pnpm gen:api`). */
export function createApiClient(baseUrl: string, options: Omit<ClientOptions, 'baseUrl'> = {}) {
  return createClient<paths>({ ...options, baseUrl });
}

export type ApiClient = ReturnType<typeof createApiClient>;

/** Response and request shapes from the generated spec. Never redefined by hand. */
export type Schemas = components['schemas'];
