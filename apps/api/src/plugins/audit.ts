import { insertAuditEntry } from '@ie-ledger/db';
import type { FastifyInstance, FastifyRequest } from 'fastify';

// req.audit(entity, id, before, after) writes one audit_log row inside req.tx, with the
// signed-in user as actor and the request id. Values are stored as JSON: bigint becomes a
// decimal string (like money on the wire), Date an ISO timestamp.

export interface AuditOptions {
  /** Defaults to create / update / delete from which of before and after is null. */
  action?: string;
  /** Defaults to the org of the route (`req.membership`). Needed on routes without :orgId. */
  orgId?: string;
}

type AuditFn = (
  entity: string,
  entityId: string | null,
  before: object | null,
  after: object | null,
  opts?: AuditOptions,
) => Promise<void>;

declare module 'fastify' {
  interface FastifyRequest {
    audit: AuditFn;
  }
}

/** JSON-safe copy for jsonb: bigint → string, Date → ISO string, undefined dropped. */
export function toAuditJson(value: object): Record<string, unknown> {
  return JSON.parse(
    JSON.stringify(value, (_key, v: unknown) => (typeof v === 'bigint' ? v.toString() : v)),
  ) as Record<string, unknown>;
}

function defaultAction(before: object | null, after: object | null) {
  if (before === null) return 'create';
  if (after === null) return 'delete';
  return 'update';
}

export function registerAudit(app: FastifyInstance) {
  app.decorateRequest('audit', async function audit(
    this: FastifyRequest,
    entity,
    entityId,
    before,
    after,
    opts = {},
  ) {
    const orgId = opts.orgId ?? this.membership.orgId;
    await insertAuditEntry(this.tx, orgId, {
      actorId: this.ctx.session?.user.id ?? null,
      action: opts.action ?? defaultAction(before, after),
      entity,
      entityId,
      before: before === null ? null : toAuditJson(before),
      after: after === null ? null : toAuditJson(after),
      requestId: this.id,
    });
    this.ctx.auditCount += 1;
  } satisfies AuditFn);
}
