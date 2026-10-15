-- Ledger invariants enforced in the database (ADR 0003, ARCHITECTURE §4).
--
-- 1. Postings are insert-only: UPDATE, DELETE and TRUNCATE are rejected.
-- 2. Transactions are immutable except for `description` and `notes`; DELETE and TRUNCATE are
--    rejected. Corrections are reversing transactions.
-- 3. At commit (deferred constraint triggers) every transaction touched in the DB transaction:
--    a. has at least 2 postings,
--    b. sums to zero per currency,
--    c. has a payment_method if it posts to an SBS income account (return lines 18-21).
--
-- Errors carry SQLSTATE and a constraint name so the API can map them:
--   immutability -> 23001 restrict_violation, constraint 'ledger_immutable'
--   balance etc. -> 23514 check_violation, constraints 'transaction_min_postings',
--                   'transaction_balanced', 'transaction_payment_method_required'

CREATE FUNCTION ledger_reject_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% on % is not allowed: the ledger is insert-only, post a reversing transaction instead', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation', CONSTRAINT = 'ledger_immutable', TABLE = TG_TABLE_NAME;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER postings_reject_update_delete
  BEFORE UPDATE OR DELETE ON postings
  FOR EACH ROW EXECUTE FUNCTION ledger_reject_change();
--> statement-breakpoint

CREATE TRIGGER postings_reject_truncate
  BEFORE TRUNCATE ON postings
  FOR EACH STATEMENT EXECUTE FUNCTION ledger_reject_change();
--> statement-breakpoint

CREATE TRIGGER transactions_reject_delete
  BEFORE DELETE ON transactions
  FOR EACH ROW EXECUTE FUNCTION ledger_reject_change();
--> statement-breakpoint

CREATE TRIGGER transactions_reject_truncate
  BEFORE TRUNCATE ON transactions
  FOR EACH STATEMENT EXECUTE FUNCTION ledger_reject_change();
--> statement-breakpoint

CREATE FUNCTION ledger_guard_transaction_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - 'description' - 'notes') IS DISTINCT FROM (to_jsonb(OLD) - 'description' - 'notes') THEN
    RAISE EXCEPTION 'only description and notes of a posted transaction can change (transaction %)', OLD.id
      USING ERRCODE = 'restrict_violation', CONSTRAINT = 'ledger_immutable', TABLE = TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER transactions_guard_update
  BEFORE UPDATE ON transactions
  FOR EACH ROW EXECUTE FUNCTION ledger_guard_transaction_update();
--> statement-breakpoint

CREATE FUNCTION ledger_check_transaction() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  tx_id uuid;
  posting_count integer;
  unbalanced_currency text;
  unbalanced_sum bigint;
BEGIN
  IF TG_TABLE_NAME = 'postings' THEN
    tx_id := NEW.transaction_id;
  ELSE
    tx_id := NEW.id;
  END IF;

  SELECT count(*) INTO posting_count FROM postings WHERE transaction_id = tx_id;
  IF posting_count < 2 THEN
    RAISE EXCEPTION 'transaction % has % posting(s); at least 2 are required', tx_id, posting_count
      USING ERRCODE = 'check_violation', CONSTRAINT = 'transaction_min_postings', TABLE = 'transactions';
  END IF;

  SELECT currency, sum(amount_minor) INTO unbalanced_currency, unbalanced_sum
    FROM postings
    WHERE transaction_id = tx_id
    GROUP BY currency
    HAVING sum(amount_minor) <> 0
    ORDER BY currency
    LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'transaction % is unbalanced in %: postings sum to % minor units', tx_id, unbalanced_currency, unbalanced_sum
      USING ERRCODE = 'check_violation', CONSTRAINT = 'transaction_balanced', TABLE = 'postings';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM postings p
      JOIN accounts a ON a.id = p.account_id
      JOIN transactions t ON t.id = p.transaction_id
     WHERE p.transaction_id = tx_id
       AND a.income_class = 'sbs'
       AND t.payment_method IS NULL
  ) THEN
    RAISE EXCEPTION 'transaction % posts SBS income and needs a payment_method', tx_id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'transaction_payment_method_required', TABLE = 'transactions';
  END IF;

  RETURN NULL;
END;
$$;
--> statement-breakpoint

CREATE CONSTRAINT TRIGGER postings_check_transaction
  AFTER INSERT ON postings
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ledger_check_transaction();
--> statement-breakpoint

CREATE CONSTRAINT TRIGGER transactions_check_postings
  AFTER INSERT ON transactions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ledger_check_transaction();
