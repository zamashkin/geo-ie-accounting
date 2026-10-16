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
import type { Db } from '@ie-ledger/db';
import type { AuthSettings } from './auth/better-auth';
import type { Mailer } from './auth/mailer';
import { DEV_AUTH_SETTINGS, registerPlatform } from './plugins/index';
import { REPLAYED_HEADER } from './plugins/mutations';
import { registerProblemHandlers } from './problem';
import { healthRoutes } from './routes/health';
import { accountRoutes } from './routes/accounts/index';
import { dashboardRoutes } from './routes/dashboard/index';
import { declarationRoutes } from './routes/declarations/index';
import { importRoutes } from './routes/imports/index';
import { offlineLedgerDeps, type LedgerDeps } from './routes/ledger-deps';
import { ratesRoutes, unavailableRatesDeps, type RatesRouteDeps } from './routes/rates/index';
import { ruleRoutes } from './routes/rules/index';
import { transactionRoutes } from './routes/transactions/index';

export interface AppConfig {
  version: string;
  webOrigin: string;
  logger: NonNullable<FastifyServerOptions['logger']>;
  /** Better Auth settings; local-dev defaults when omitted (OpenAPI script, unit tests). */
  auth?: Partial<AuthSettings>;
}

/** External dependencies, injected so tests and the OpenAPI script can run without a database. */
export interface AppDeps {
  checkDatabase: () => Promise<boolean>;
  rates?: RatesRouteDeps;
  /** NBG source and clock for imports and the dashboard; offline (503 on a missing rate) if omitted. */
  ledger?: LedgerDeps;
  db?: Db;
  mailer?: Mailer;
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
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
    exposedHeaders: [REQUEST_ID_HEADER, REPLAYED_HEADER],
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
      tags: [
        { name: 'system', description: 'Health and metadata' },
        { name: 'auth', description: 'Session (Better Auth itself is mounted at /v1/auth/*)' },
        { name: 'orgs', description: 'Organizations' },
        { name: 'members', description: 'Members and invitations' },
        { name: 'rates', description: 'NBG exchange rates' },
        { name: 'accounts', description: 'Chart of accounts and bank accounts' },
        { name: 'imports', description: 'Bank statement imports: upload, preview, commit' },
        { name: 'transactions', description: 'Ledger transactions and reversals' },
        { name: 'rules', description: 'Categorisation rules for statement imports' },
        { name: 'declarations', description: 'Monthly SBS declaration figures and filings' },
        { name: 'dashboard', description: 'Year-to-date summary' },
      ],
    },
    transform: jsonSchemaTransform,
    transformObject: jsonSchemaTransformObject,
  });

  await registerPlatform(app, {
    webOrigin: config.webOrigin,
    auth: { ...DEV_AUTH_SETTINGS, trustedOrigins: [config.webOrigin], ...config.auth },
    db: deps.db,
    mailer: deps.mailer,
  });

  await app.register(healthRoutes, {
    version: config.version,
    checkDatabase: deps.checkDatabase,
  });
  await app.register(ratesRoutes, { deps: deps.rates ?? unavailableRatesDeps });

  const ledger = deps.ledger ?? offlineLedgerDeps;
  await app.register(accountRoutes, { deps: ledger });
  await app.register(importRoutes, { deps: ledger });
  await app.register(transactionRoutes, { deps: ledger });
  await app.register(ruleRoutes);
  await app.register(declarationRoutes, { deps: ledger });
  await app.register(dashboardRoutes, { deps: ledger });

  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;
