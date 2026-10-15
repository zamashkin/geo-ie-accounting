import { createHash } from 'node:crypto';
import { IdempotencyKey } from '@ie-ledger/contracts';
import { claimIdempotencyKey, completeIdempotencyKey, type IdempotencyScope } from '@ie-ledger/db';
import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  preValidationAsyncHookHandler,
  RouteHandlerMethod,
  RouteOptions,
} from 'fastify';
import { AUTH_BASE_PATH } from '../auth/better-auth';
import { HttpProblem } from '../problem';

// Every mutating /v1 route (POST, PUT, PATCH, DELETE) runs through `withTx`:
//
//   1. One DB transaction for the whole handler, exposed as `req.tx`.
//   2. `Idempotency-Key` (ADR 0010): the key is claimed in that transaction before the handler
//      runs; a replay with the same request returns the stored status and body with
//      `Idempotent-Replayed: true`, a different request with the same key gets 422.
//   3. The response body is serialised and stored before COMMIT, so the stored response, the
//      data and the audit row commit together. Deferred constraint errors raised at COMMIT
//      (e.g. transaction_balanced) still turn into an error response, never a false 2xx.
//   4. Tenant routes must write at least one audit row (`req.audit`), or the request fails.
//
// Handlers return their payload (after `reply.code(201)` if needed) instead of calling
// `reply.send()`: the wrapper sends it after COMMIT.
// Opt out with `config: { tx: false }` (read-only POSTs such as the invitation preview).

export const REPLAYED_HEADER = 'idempotent-replayed';
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const TENANT_ROUTE = /^\/v1\/orgs\/:orgId(\/|$)/;

/** Deterministic JSON: object keys sorted, so key order does not change the request hash. */
export function canonicalJson(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

/** sha256 over method, URL (path + query) and the body as received, before validation. */
export function requestHash(method: string, url: string, body: unknown): string {
  return createHash('sha256')
    .update(`${method} ${url}\n${canonicalJson(body ?? null)}`)
    .digest('hex');
}

const captureIdempotency: preValidationAsyncHookHandler = async (req) => {
  const header = req.headers['idempotency-key'];
  if (header === undefined) return;
  const parsed = IdempotencyKey.safeParse(header);
  if (!parsed.success) {
    throw new HttpProblem(
      400,
      'bad_request',
      'Idempotency-Key must be 1-255 visible ASCII characters.',
    );
  }
  req.ctx.idempotencyKey = parsed.data;
  req.ctx.requestHash = requestHash(req.method, req.url, req.body);
};

type Outcome =
  | { kind: 'replay'; statusCode: number; body: unknown }
  | { kind: 'fresh'; body: string | undefined };

function wrapHandler(handler: RouteHandlerMethod, mustAudit: boolean): RouteHandlerMethod {
  return async function withTx(this: FastifyInstance, req: FastifyRequest, reply: FastifyReply) {
    const key = req.ctx.idempotencyKey;
    const userId = req.ctx.session?.user.id;
    // Keys only mean something for a known caller; unauthenticated mutations ignore them.
    const scope: IdempotencyScope | null =
      key !== null && userId !== undefined
        ? { orgId: req.ctx.membership?.orgId ?? null, userId, key }
        : null;

    const outcome = await req.server.db.transaction(async (tx): Promise<Outcome> => {
      req.ctx.tx = tx;
      try {
        if (scope) {
          const claim = await claimIdempotencyKey(tx, scope, req.ctx.requestHash ?? '');
          if (claim.status === 'existing') {
            if (claim.record.requestHash !== req.ctx.requestHash) {
              throw new HttpProblem(
                422,
                'idempotency_key_reused',
                'This Idempotency-Key was already used for a different request.',
              );
            }
            if (claim.record.statusCode === null) {
              throw new HttpProblem(409, 'conflict', 'The original request is still running.');
            }
            return {
              kind: 'replay',
              statusCode: claim.record.statusCode,
              body: claim.record.response,
            };
          }
        }

        const payload: unknown = await handler.call(this, req, reply);
        if (reply.sent) {
          throw new Error(
            `${req.method} ${req.routeOptions.url ?? req.url}: return the payload, do not call reply.send()`,
          );
        }
        if (mustAudit && req.ctx.auditCount === 0) {
          throw new Error(
            `${req.method} ${req.routeOptions.url ?? req.url}: mutation wrote no audit_log row`,
          );
        }
        // The route's serializer (Zod, JSON) always yields a string.
        const body =
          payload === undefined || payload === null
            ? undefined
            : (reply.serialize(payload) as string);
        if (scope) {
          await completeIdempotencyKey(
            tx,
            scope,
            reply.statusCode,
            body === undefined ? null : (JSON.parse(body) as unknown),
          );
        }
        return { kind: 'fresh', body };
      } finally {
        req.ctx.tx = null;
      }
    });

    if (outcome.kind === 'replay') {
      reply.code(outcome.statusCode).header(REPLAYED_HEADER, 'true');
      if (outcome.body === null) return reply.send();
      return reply
        .type('application/json; charset=utf-8')
        .serializer((p: unknown) => p as string)
        .send(JSON.stringify(outcome.body));
    }
    if (outcome.body === undefined) return reply.send();
    return reply
      .type('application/json; charset=utf-8')
      .serializer((p: unknown) => p as string)
      .send(outcome.body);
  };
}

function appendHook<T>(existing: T | T[] | undefined, hook: T): T[] {
  if (existing === undefined) return [hook];
  return Array.isArray(existing) ? [...existing, hook] : [existing, hook];
}

export function registerMutations(app: FastifyInstance) {
  app.addHook('onRoute', (route: RouteOptions) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    const mutating = methods.some((m) => MUTATING.has(m));
    if (!mutating || !route.url.startsWith('/v1/') || route.url.startsWith(`${AUTH_BASE_PATH}/`)) {
      return;
    }
    if (route.config?.tx === false) return;
    route.preValidation = appendHook(route.preValidation, captureIdempotency);
    route.handler = wrapHandler(
      route.handler,
      TENANT_ROUTE.test(route.url) && route.config?.audit !== false,
    );
  });
}
