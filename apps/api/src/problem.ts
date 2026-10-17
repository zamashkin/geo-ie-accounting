import {
  PROBLEM_CONTENT_TYPE,
  Problem,
  type Problem as ProblemBody,
  type ProblemCode,
} from '@geo-ie-accounting/contracts';
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
} from 'fastify-type-provider-zod';
import { STATUS_CODES } from 'node:http';
import { problemFromDbError } from './plugins/db-errors';

/** Throw from a route to answer with RFC 9457 problem+json. */
export class HttpProblem extends Error {
  constructor(
    readonly status: number,
    readonly code: ProblemCode,
    readonly detail?: string,
    readonly errors?: { path: string; message: string }[],
  ) {
    super(detail ?? code);
    this.name = 'HttpProblem';
  }
}

export const problemType = (code: ProblemCode) => `urn:geo-ie-accounting:problem:${code}`;

function body(
  req: FastifyRequest,
  status: number,
  code: ProblemCode,
  detail?: string,
  errors?: { path: string; message: string }[],
): ProblemBody {
  return {
    type: problemType(code),
    title: STATUS_CODES[status] ?? 'Error',
    status,
    code,
    requestId: req.id,
    instance: req.url,
    ...(detail === undefined ? {} : { detail }),
    ...(errors === undefined ? {} : { errors }),
  };
}

function send(reply: FastifyReply, problem: ProblemBody) {
  return reply.status(problem.status).type(PROBLEM_CONTENT_TYPE).send(problem);
}

const CODE_BY_STATUS: Partial<Record<number, ProblemCode>> = {
  400: 'bad_request',
  401: 'unauthenticated',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  413: 'payload_too_large',
  415: 'bad_request',
  429: 'rate_limited',
  503: 'service_unavailable',
};

/** Response entry for route schemas: any error is problem+json. */
export const problemResponse = {
  description: 'Error (RFC 9457 problem details)',
  content: { [PROBLEM_CONTENT_TYPE]: { schema: Problem } },
} as const;

export function registerProblemHandlers(app: FastifyInstance) {
  app.setNotFoundHandler((req, reply) =>
    send(reply, body(req, 404, 'not_found', `No route for ${req.method} ${req.url}`)),
  );

  app.setErrorHandler((err: FastifyError, req, reply) => {
    if (err instanceof HttpProblem) {
      return send(reply, body(req, err.status, err.code, err.detail, err.errors));
    }
    if (hasZodFastifySchemaValidationErrors(err)) {
      const errors = err.validation.map((v) => ({
        path: `${err.validationContext ?? 'request'}${v.instancePath || ''}`,
        message: v.message ?? 'Invalid value',
      }));
      return send(
        reply,
        body(req, 400, 'validation_failed', 'The request does not match the schema.', errors),
      );
    }
    if (isResponseSerializationError(err)) {
      req.log.error({ err }, 'response does not match its schema');
      return send(reply, body(req, 500, 'internal_error'));
    }
    const db = problemFromDbError(err);
    if (db) return send(reply, body(req, db.status, db.code, db.detail));
    const status = err.statusCode ?? 500;
    if (status >= 400 && status < 500) {
      return send(reply, body(req, status, CODE_BY_STATUS[status] ?? 'bad_request', err.message));
    }
    req.log.error({ err }, 'unhandled error');
    return send(reply, body(req, status >= 500 ? status : 500, 'internal_error'));
  });
}
