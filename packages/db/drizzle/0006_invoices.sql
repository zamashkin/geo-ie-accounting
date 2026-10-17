-- Invoices (WS-09): client profile fields, the org's invoice profile, per-year gapless numbering
-- (invoice_sequences), stored totals and the frozen print snapshot, composite FKs that keep
-- invoices, clients, bank accounts, payments and transactions in one org, and triggers that keep
-- issued invoices immutable apart from their status. No route wrote invoices before this
-- migration, so the number column changes type in place.
CREATE TABLE "invoice_sequences" (
	"org_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"last_seq" integer NOT NULL,
	CONSTRAINT "invoice_sequences_org_id_year_pk" PRIMARY KEY("org_id","year"),
	CONSTRAINT "invoice_sequences_last_seq_positive" CHECK ("invoice_sequences"."last_seq" > 0)
);
--> statement-breakpoint
ALTER TABLE "invoices" DROP CONSTRAINT "invoices_number_when_issued";--> statement-breakpoint
ALTER TABLE "invoice_payments" DROP CONSTRAINT "invoice_payments_invoice_id_invoices_id_fk";
--> statement-breakpoint
ALTER TABLE "invoice_payments" DROP CONSTRAINT "invoice_payments_transaction_id_transactions_id_fk";
--> statement-breakpoint
ALTER TABLE "invoices" DROP CONSTRAINT "invoices_client_id_clients_id_fk";
--> statement-breakpoint
ALTER TABLE "invoices" ALTER COLUMN "number" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "address" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "invoice_prefix" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "invoice_due_days" integer DEFAULT 14 NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "invoice_note" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "tax_id" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "address" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "number_year" integer;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "number_seq" integer;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "bank_account_id" uuid;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "total_minor" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "issued_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "voided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_id_org_id_uq" UNIQUE("id","org_id");--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_id_org_id_uq" UNIQUE("id","org_id");--> statement-breakpoint
ALTER TABLE "invoice_sequences" ADD CONSTRAINT "invoice_sequences_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_invoice_fk" FOREIGN KEY ("invoice_id","org_id") REFERENCES "public"."invoices"("id","org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_transaction_fk" FOREIGN KEY ("transaction_id","org_id") REFERENCES "public"."transactions"("id","org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_client_fk" FOREIGN KEY ("client_id","org_id") REFERENCES "public"."clients"("id","org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_bank_account_fk" FOREIGN KEY ("bank_account_id","org_id") REFERENCES "public"."accounts"("id","org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invoice_payments_org_transaction_idx" ON "invoice_payments" USING btree ("org_id","transaction_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_org_year_seq_uq" ON "invoices" USING btree ("org_id","number_year","number_seq");--> statement-breakpoint
CREATE INDEX "invoices_org_client_idx" ON "invoices" USING btree ("org_id","client_id");--> statement-breakpoint
ALTER TABLE "invoices" DROP COLUMN "pdf_key";--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_invoice_due_days_range" CHECK ("organizations"."invoice_due_days" between 0 and 365);--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_quantity_positive" CHECK ("invoice_lines"."quantity" > 0);--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_unit_price_nonnegative" CHECK ("invoice_lines"."unit_price_minor" >= 0);--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_dates_when_issued" CHECK ("invoices"."status" = 'draft' or ("invoices"."issue_date" is not null and "invoices"."due_date" is not null and "invoices"."snapshot" is not null));--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_due_after_issue" CHECK ("invoices"."issue_date" is null or "invoices"."due_date" is null or "invoices"."due_date" >= "invoices"."issue_date");--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_total_nonnegative" CHECK ("invoices"."total_minor" >= 0);--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_number_when_issued" CHECK ((("invoices"."status" = 'draft') = ("invoices"."number" is null)) and (("invoices"."number" is null) = ("invoices"."number_year" is null)) and (("invoices"."number" is null) = ("invoices"."number_seq" is null)));--> statement-breakpoint

-- Issued invoices never change apart from their status. Allowed transitions: draft -> issued,
-- issued -> paid / void, paid -> issued (a payment unmatched). A void invoice keeps its number
-- and stays void. Only drafts can be deleted. Same SQLSTATE as the ledger triggers (23001),
-- constraint 'invoice_immutable'.
CREATE FUNCTION invoices_guard_issued() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'An issued invoice cannot be deleted; void it instead'
        USING ERRCODE = 'restrict_violation', CONSTRAINT = 'invoice_immutable', TABLE = TG_TABLE_NAME;
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'draft' THEN
    RETURN NEW;
  END IF;
  IF NOT ((OLD.status = 'issued' AND NEW.status IN ('issued', 'paid', 'void'))
       OR (OLD.status = 'paid' AND NEW.status IN ('paid', 'issued'))
       OR (OLD.status = 'void' AND NEW.status = 'void')) THEN
    RAISE EXCEPTION 'Invoice status cannot go from % to %', OLD.status, NEW.status
      USING ERRCODE = 'restrict_violation', CONSTRAINT = 'invoice_immutable', TABLE = TG_TABLE_NAME;
  END IF;
  IF (NEW.client_id, NEW.number, NEW.number_year, NEW.number_seq, NEW.issue_date, NEW.due_date,
      NEW.currency, NEW.bank_account_id, NEW.notes, NEW.total_minor, NEW.snapshot, NEW.issued_at,
      NEW.org_id, NEW.created_at)
     IS DISTINCT FROM
     (OLD.client_id, OLD.number, OLD.number_year, OLD.number_seq, OLD.issue_date, OLD.due_date,
      OLD.currency, OLD.bank_account_id, OLD.notes, OLD.total_minor, OLD.snapshot, OLD.issued_at,
      OLD.org_id, OLD.created_at) THEN
    RAISE EXCEPTION 'An issued invoice cannot be edited; only its status changes'
      USING ERRCODE = 'restrict_violation', CONSTRAINT = 'invoice_immutable', TABLE = TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER invoices_guard_issued
  BEFORE UPDATE OR DELETE ON invoices
  FOR EACH ROW EXECUTE FUNCTION invoices_guard_issued();
--> statement-breakpoint

-- Lines of an issued invoice are frozen with it.
CREATE FUNCTION invoice_lines_guard_issued() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  parent_status invoice_status;
BEGIN
  SELECT status INTO parent_status FROM invoices
    WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.invoice_id ELSE NEW.invoice_id END;
  -- A cascaded delete of a draft invoice finds no parent row any more.
  IF parent_status IS NOT NULL AND parent_status <> 'draft' THEN
    RAISE EXCEPTION 'Lines of an issued invoice cannot change'
      USING ERRCODE = 'restrict_violation', CONSTRAINT = 'invoice_immutable', TABLE = TG_TABLE_NAME;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.invoice_id <> OLD.invoice_id THEN
    RAISE EXCEPTION 'A line cannot move to another invoice'
      USING ERRCODE = 'restrict_violation', CONSTRAINT = 'invoice_immutable', TABLE = TG_TABLE_NAME;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER invoice_lines_guard_issued
  BEFORE INSERT OR UPDATE OR DELETE ON invoice_lines
  FOR EACH ROW EXECUTE FUNCTION invoice_lines_guard_issued();
