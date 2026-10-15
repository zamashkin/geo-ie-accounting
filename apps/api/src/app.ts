import { randomUUID } from 'node:crypto';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import Fastify, { LogController, type FastifyServerOptions } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { jsonSchemaTransform, jsonSchemaTransformObject } from './openapi';
import { registerProblemHandlers } from './problem';
import { healthRoutes } from './routes/health';
import { ratesRoutes, unavailableRatesDeps, type RatesRouteDeps } from './routes/rates/index';

export interface AppConfig {
  version: string;
  webOrigin: string;
  logger: NonNullable<FastifyServerOptions['logger']>;
}

/** External dependencies, injected so tests and the OpenAPI script can run without a database. */
export interface AppDeps {
  checkDatabase: () => Promise<boolean>;
  rates?: RatesRouteDeps;
}

const REQUEST_ID_HEADER = 'x-request-id';
const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

/** Fields never written to logs: credentials and anything that can carry statement data. */
export const LOG_REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["idempotency-key"]',
  'res.headers["set-cookie"]',
];

export async function buildApp(config: AppConfig, deps: AppDeps) {
  const app = Fastify({
    logger: config.logger,
    // Use the caller's x-request-id when it is safe to log, otherwise a new UUID.
    genReqId: (req) => {
      const header = req.headers[REQUEST_ID_HEADER];
      return typeof header === 'string' && SAFE_REQUEST_ID.test(header) ? header : randomUUID();
    },
    logController: new LogController({ requestIdLogLabel: 'requestId' }),
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.addHook('onSend', async (req, reply) => {
    reply.header(REQUEST_ID_HEADER, req.id);
  });

  registerProblemHandlers(app);

  await app.register(cors, {
    origin: config.webOrigin,
    credentials: true,
    exposedHeaders: [REQUEST_ID_HEADER],
  });

  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'IE Ledger API',
        description:
          'Bookkeeping and 1% small-business tax figures for Georgian individual entrepreneurs. ' +
          'Money amounts are integer minor units encoded as strings.',
        version: '0.1.0',
      },
      servers: [{ url: 'http://localhost:4000', description: 'Local development' }],
      tags: [{ name: 'system', description: 'Health and metadata' }],
    },
    transform: jsonSchemaTransform,
    transformObject: jsonSchemaTransformObject,
  });

  await app.register(healthRoutes, {
    version: config.version,
    checkDatabase: deps.checkDatabase,
  });
  await app.register(ratesRoutes, { deps: deps.rates ?? unavailableRatesDeps });

  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;
