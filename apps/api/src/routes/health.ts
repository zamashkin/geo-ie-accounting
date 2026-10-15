import { HealthResponse } from '@ie-ledger/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { problemResponse } from '../problem';

export interface HealthOptions {
  version: string;
  checkDatabase: () => Promise<boolean>;
}

export const healthRoutes: FastifyPluginAsyncZod<HealthOptions> = async (app, opts) => {
  app.get(
    '/healthz',
    {
      schema: {
        operationId: 'getHealth',
        tags: ['system'],
        summary: 'Liveness and dependency checks',
        response: { 200: HealthResponse, 503: HealthResponse, default: problemResponse },
      },
      logLevel: 'warn',
    },
    async (_req, reply) => {
      const database = (await opts.checkDatabase()) ? 'ok' : 'fail';
      const ok = database === 'ok';
      return reply.status(ok ? 200 : 503).send({
        status: ok ? 'ok' : 'degraded',
        version: opts.version,
        time: new Date().toISOString(),
        checks: { database },
      });
    },
  );
};
