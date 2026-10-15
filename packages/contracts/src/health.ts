import { z } from 'zod';
import { Timestamp } from './primitives';

export const CheckStatus = z.enum(['ok', 'fail']);

/** GET /healthz */
export const HealthResponse = z
  .object({
    status: z.enum(['ok', 'degraded']),
    version: z.string(),
    time: Timestamp,
    checks: z.object({ database: CheckStatus }),
  })
  .meta({ id: 'HealthResponse' });
export type HealthResponse = z.output<typeof HealthResponse>;
