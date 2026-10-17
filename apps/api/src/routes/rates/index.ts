import { createHash, timingSafeEqual } from 'node:crypto';
import {
  BackfillRatesRequest,
  BackfillRatesResponse,
  type ExchangeRate,
  ListRatesQuery,
  ListRatesResponse,
} from '@geo-ie-accounting/contracts';
import type { ExchangeRateRow, RatesCursor } from '@geo-ie-accounting/db';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { HttpProblem, problemResponse } from '../../problem';
import { QueueUnavailableError, type RatesRouteDeps } from './deps';

export { createRatesRouteDeps, QueueUnavailableError, type RatesRouteDeps } from './deps';

/** Answers 503 until the app is given real deps (OpenAPI generation, tests of other routes). */
export const unavailableRatesDeps: RatesRouteDeps = {
  listRates: () => Promise.reject(new HttpProblem(503, 'service_unavailable')),
  enqueueBackfill: () => Promise.reject(new HttpProblem(503, 'service_unavailable')),
  adminToken: undefined,
};

export const ADMIN_TOKEN_HEADER = 'x-admin-token';

// ── Cursor: base64url of the last row's (validFrom, currency) ───────────────────────────

const CursorJson = z.object({ v: z.iso.date(), c: z.string().regex(/^[A-Z]{3}$/) });

export function encodeRatesCursor(c: RatesCursor): string {
  return Buffer.from(JSON.stringify({ v: c.validFrom, c: c.currency })).toString('base64url');
}

function decodeRatesCursor(cursor: string): RatesCursor {
  try {
    const parsed = CursorJson.parse(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')));
    return { validFrom: parsed.v, currency: parsed.c };
  } catch {
    throw new HttpProblem(400, 'validation_failed', 'Invalid cursor.', [
      { path: 'querystring/cursor', message: 'Invalid cursor' },
    ]);
  }
}

function toDto(row: ExchangeRateRow): ExchangeRate {
  return {
    id: row.id,
    currency: row.currency,
    validFrom: row.validFrom,
    rate: row.rate,
    quantity: row.quantity,
    source: 'nbg',
    setAt: row.setAt?.toISOString() ?? null,
    fetchedAt: row.fetchedAt.toISOString(),
  };
}

// ── Admin guard ─────────────────────────────────────────────────────────────────────────

const digest = (s: string) => createHash('sha256').update(s).digest();

/**
 * STUB(WS-05): stands in for `requireRole('admin')` until auth lands. Compares the
 * `x-admin-token` header with ADMIN_TOKEN in constant time. WS-05/WS-10: replace this with the
 * real admin check and drop ADMIN_TOKEN.
 */
function requireAdminToken(req: FastifyRequest, expected: string | undefined) {
  if (!expected) {
    throw new HttpProblem(403, 'forbidden', 'Rate backfill is disabled on this server.');
  }
  const header = req.headers[ADMIN_TOKEN_HEADER];
  if (typeof header !== 'string' || header.length === 0) {
    throw new HttpProblem(401, 'unauthenticated', `Send the admin token in ${ADMIN_TOKEN_HEADER}.`);
  }
  if (!timingSafeEqual(digest(header), digest(expected))) {
    throw new HttpProblem(403, 'forbidden', 'Admin access required.');
  }
}

// ── Routes ──────────────────────────────────────────────────────────────────────────────

export const ratesRoutes: FastifyPluginAsyncZod<{ deps: RatesRouteDeps }> = async (app, opts) => {
  const { deps } = opts;
  app.addHook('onClose', async () => {
    await deps.close?.();
  });

  app.get(
    '/v1/rates',
    {
      schema: {
        operationId: 'listRates',
        tags: ['rates'],
        summary: 'NBG exchange rates, newest first',
        description:
          'GEL per `quantity` units, one row per day a rate starts (`validFrom`). The rate for a ' +
          'date is the row with the greatest `validFrom` on or before it (SPEC §2.3).',
        querystring: ListRatesQuery,
        response: { 200: ListRatesResponse, default: problemResponse },
      },
    },
    async (req) => {
      const { currency, from, to, limit, cursor } = req.query;
      const page = await deps.listRates({
        currency,
        from,
        to,
        limit,
        after: cursor ? decodeRatesCursor(cursor) : undefined,
      });
      return {
        items: page.items.map(toDto),
        nextCursor: page.next ? encodeRatesCursor(page.next) : null,
      };
    },
  );

  app.post(
    '/v1/rates/backfill',
    {
      schema: {
        operationId: 'backfillRates',
        tags: ['rates'],
        summary: 'Queue a backfill of NBG rates for a date range (admin)',
        description:
          'Idempotent: dates already stored are not duplicated. Emits `rates.backfilled` when ' +
          `done. Temporary admin check: the \`${ADMIN_TOKEN_HEADER}\` header (replaced by WS-05).`,
        headers: z.object({ [ADMIN_TOKEN_HEADER]: z.string().optional() }),
        body: BackfillRatesRequest,
        response: { 202: BackfillRatesResponse, default: problemResponse },
      },
      // Only enqueues through pg-boss's own connection: nothing to write in a request
      // transaction. Rates are global, so there is no org audit row either.
      config: { tx: false },
      // Before body validation, so callers without access learn nothing about the schema.
      onRequest: async (req) => {
        requireAdminToken(req, deps.adminToken);
      },
    },
    async (req, reply) => {
      let jobId: string;
      try {
        jobId = await deps.enqueueBackfill({ ...req.body, meta: { requestId: req.id } });
      } catch (err) {
        if (err instanceof QueueUnavailableError) {
          req.log.error({ err }, 'could not enqueue rates.backfill');
          throw new HttpProblem(503, 'service_unavailable', 'The job queue is unavailable.');
        }
        throw err;
      }
      req.log.info({ jobId, ...req.body }, 'rates backfill queued');
      return reply.status(202).send({ jobId, status: 'queued' as const });
    },
  );
};
