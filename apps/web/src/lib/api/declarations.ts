'use client';

import { browserApi, idempotencyHeaders } from './browser';
import type { Schemas } from './client';
import { unwrap } from './errors';

// Declaration filing for client components. Reads happen in server components.

export type DeclarationFiling = Schemas['DeclarationFiling'];

/** Records that the return was filed on rs.ge; pass the latest filing id to file a correction. */
export function fileDeclaration(
  orgId: string,
  period: string,
  body: Schemas['FileDeclarationRequestInput'],
  key: string,
) {
  return unwrap(
    browserApi().POST('/v1/orgs/{orgId}/declarations/{period}/file', {
      params: { path: { orgId, period } },
      headers: idempotencyHeaders(key),
      body,
    }),
  );
}
