import { z } from 'zod';

/** Machine-readable error codes. Add codes here, never ad hoc in a route. */
export const PROBLEM_CODES = [
  'bad_request',
  'validation_failed',
  'unauthenticated',
  'forbidden',
  'not_found',
  'conflict',
  'idempotency_key_reused',
  'rate_unavailable',
  'payload_too_large',
  'rate_limited',
  'internal_error',
  'service_unavailable',
] as const;
export const ProblemCode = z.enum(PROBLEM_CODES);
export type ProblemCode = z.output<typeof ProblemCode>;

/** RFC 9457 problem details, served as `application/problem+json`. */
export const Problem = z
  .object({
    type: z.string().meta({ description: 'URI reference identifying the problem type.' }),
    title: z.string(),
    status: z.int().min(400).max(599),
    detail: z.string().optional(),
    instance: z.string().optional(),
    code: ProblemCode,
    requestId: z.string(),
    /** Field-level validation issues for `validation_failed`. */
    errors: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  })
  .meta({ id: 'Problem' });
export type Problem = z.output<typeof Problem>;

export const PROBLEM_CONTENT_TYPE = 'application/problem+json';
