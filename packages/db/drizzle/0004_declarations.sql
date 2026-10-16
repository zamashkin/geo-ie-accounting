-- Declaration filing (WS-08 on the MVP compute-on-request model). The unused draft
-- `declarations` table goes: live figures are computed from postings on every request, and
-- `declaration_filings` keeps one immutable snapshot per filing, corrections included.
DROP TABLE "declarations" CASCADE;--> statement-breakpoint
DROP TYPE "public"."declaration_status";--> statement-breakpoint
CREATE TABLE "declaration_filings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"period" char(7) NOT NULL,
	"version" integer NOT NULL,
	"supersedes_id" uuid,
	"rules_version" text NOT NULL,
	"income_gel_minor" bigint NOT NULL,
	"ytd_gel_minor" bigint NOT NULL,
	"by_payment_method" jsonb NOT NULL,
	"rate_bp" integer NOT NULL,
	"tax_gel_minor" bigint NOT NULL,
	"zero_return" boolean NOT NULL,
	"transaction_ids" uuid[] NOT NULL,
	"snapshot" jsonb NOT NULL,
	"rs_reference" text,
	"filed_by" uuid NOT NULL,
	"filed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "declaration_filings_id_org_id_uq" UNIQUE("id","org_id"),
	CONSTRAINT "declaration_filings_period_format" CHECK ("declaration_filings"."period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "declaration_filings_rate_bp_nonnegative" CHECK ("declaration_filings"."rate_bp" >= 0),
	CONSTRAINT "declaration_filings_version_chain" CHECK (("declaration_filings"."version" = 1) = ("declaration_filings"."supersedes_id" is null) and "declaration_filings"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "declaration_filings" ADD CONSTRAINT "declaration_filings_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "declaration_filings" ADD CONSTRAINT "declaration_filings_filed_by_users_id_fk" FOREIGN KEY ("filed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "declaration_filings" ADD CONSTRAINT "declaration_filings_supersedes_fk" FOREIGN KEY ("supersedes_id","org_id") REFERENCES "public"."declaration_filings"("id","org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "declaration_filings_org_period_version_uq" ON "declaration_filings" USING btree ("org_id","period","version");--> statement-breakpoint
CREATE UNIQUE INDEX "declaration_filings_supersedes_uq" ON "declaration_filings" USING btree ("supersedes_id") WHERE "declaration_filings"."supersedes_id" is not null;--> statement-breakpoint

-- Filed returns are immutable snapshots: UPDATE, DELETE and TRUNCATE are rejected. A refiling is
-- a new row (version + 1) that supersedes the previous one. Same error as the ledger triggers
-- (0001): SQLSTATE 23001, constraint 'ledger_immutable'.
CREATE FUNCTION declaration_filings_reject_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% on % is not allowed: a filed return never changes, file a correction instead', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation', CONSTRAINT = 'ledger_immutable', TABLE = TG_TABLE_NAME;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER declaration_filings_reject_update_delete
  BEFORE UPDATE OR DELETE ON declaration_filings
  FOR EACH ROW EXECUTE FUNCTION declaration_filings_reject_change();
--> statement-breakpoint
CREATE TRIGGER declaration_filings_reject_truncate
  BEFORE TRUNCATE ON declaration_filings
  FOR EACH STATEMENT EXECUTE FUNCTION declaration_filings_reject_change();
