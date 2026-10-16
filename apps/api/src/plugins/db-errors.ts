import type { ProblemCode } from '@ie-ledger/contracts';

// Maps Postgres errors to problem+json by SQLSTATE and constraint name. Drizzle wraps the
// driver error, so the cause chain is searched. Unknown database errors stay 500s.

export interface DbProblem {
  status: number;
  code: ProblemCode;
  detail: string;
}

interface PgError {
  code: string;
  constraint?: string;
}

/** The node-postgres error under Drizzle's wrapping, if there is one. */
export function findPgError(err: unknown): PgError | null {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current instanceof Error; depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) {
      const constraint = (current as { constraint?: unknown }).constraint;
      return typeof constraint === 'string' ? { code, constraint } : { code };
    }
    current = current.cause;
  }
  return null;
}

/** Readable details for named constraints. Others get a generic message per SQLSTATE. */
const CONSTRAINT_DETAIL: Record<string, string> = {
  // Ledger triggers (packages/db/drizzle/0001_ledger_triggers.sql)
  transaction_balanced: 'Postings must sum to zero in every currency.',
  transaction_min_postings: 'A transaction needs at least two postings.',
  transaction_payment_method_required:
    'A transaction that posts SBS income needs a payment method.',
  ledger_immutable: 'Posted transactions cannot be changed. Post a reversing transaction instead.',
  // Tenancy
  memberships_org_id_user_id_pk: 'This user is already a member of the organization.',
  users_email_unique: 'An account with this email already exists.',
  idempotency_keys_scope_key_uq: 'This Idempotency-Key is being used by another request.',
  accounts_org_system_key_uq: 'The organization already has this system account.',
  accounts_org_iban_currency_uq: 'An account with this IBAN and currency already exists.',
};

export function problemFromDbError(err: unknown): DbProblem | null {
  const pg = findPgError(err);
  if (!pg) return null;
  const named = pg.constraint ? CONSTRAINT_DETAIL[pg.constraint] : undefined;
  switch (pg.code) {
    case '23505': // unique_violation
      return { status: 409, code: 'conflict', detail: named ?? 'This already exists.' };
    case '23503': // foreign_key_violation
      return {
        status: 422,
        code: 'validation_failed',
        detail: named ?? 'A referenced record does not exist.',
      };
    case '23514': // check_violation (incl. the ledger balance triggers)
      return {
        status: 422,
        code: 'validation_failed',
        detail: named ?? 'The data breaks a business rule.',
      };
    case '23001': // restrict_violation (ledger_immutable)
      return { status: 409, code: 'conflict', detail: named ?? 'This change is not allowed.' };
    case '22P02': // invalid_text_representation, e.g. a malformed uuid
      return { status: 400, code: 'bad_request', detail: 'A value has the wrong format.' };
    case '40001': // serialization_failure
    case '40P01': // deadlock_detected
      return {
        status: 409,
        code: 'conflict',
        detail: 'The request clashed with a concurrent change. Retry it.',
      };
    default:
      return null;
  }
}
