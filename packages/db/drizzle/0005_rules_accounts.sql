-- Categorisation rules on the parsed row's fields (counterparty/description contains,
-- direction, currency, amount range) instead of one field/op/value, plus the rule that
-- suggested each import row. The MVP never created rules, so existing rows are dropped.
DELETE FROM "categorization_rules";--> statement-breakpoint
ALTER TABLE "categorization_rules" DROP COLUMN "field";--> statement-breakpoint
ALTER TABLE "categorization_rules" DROP COLUMN "op";--> statement-breakpoint
ALTER TABLE "categorization_rules" DROP COLUMN "value";--> statement-breakpoint
DROP TYPE "public"."rule_field";--> statement-breakpoint
DROP TYPE "public"."rule_op";--> statement-breakpoint
CREATE TYPE "public"."rule_direction" AS ENUM('in', 'out');--> statement-breakpoint
ALTER TABLE "categorization_rules" DROP CONSTRAINT "categorization_rules_target_account_id_accounts_id_fk";
--> statement-breakpoint
ALTER TABLE "categorization_rules" ADD COLUMN "name" text NOT NULL;--> statement-breakpoint
ALTER TABLE "categorization_rules" ADD COLUMN "counterparty_contains" text;--> statement-breakpoint
ALTER TABLE "categorization_rules" ADD COLUMN "description_contains" text;--> statement-breakpoint
ALTER TABLE "categorization_rules" ADD COLUMN "direction" "rule_direction";--> statement-breakpoint
ALTER TABLE "categorization_rules" ADD COLUMN "currency" char(3);--> statement-breakpoint
ALTER TABLE "categorization_rules" ADD COLUMN "amount_min_minor" bigint;--> statement-breakpoint
ALTER TABLE "categorization_rules" ADD COLUMN "amount_max_minor" bigint;--> statement-breakpoint
ALTER TABLE "categorization_rules" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "import_rows" ADD COLUMN "suggested_rule_id" uuid;--> statement-breakpoint
ALTER TABLE "categorization_rules" ADD CONSTRAINT "categorization_rules_target_account_fk" FOREIGN KEY ("target_account_id","org_id") REFERENCES "public"."accounts"("id","org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_suggested_rule_id_categorization_rules_id_fk" FOREIGN KEY ("suggested_rule_id") REFERENCES "public"."categorization_rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categorization_rules" ADD CONSTRAINT "categorization_rules_amount_range" CHECK (("categorization_rules"."amount_min_minor" is null and "categorization_rules"."amount_max_minor" is null) or "categorization_rules"."currency" is not null);--> statement-breakpoint
ALTER TABLE "categorization_rules" ADD CONSTRAINT "categorization_rules_amount_order" CHECK ("categorization_rules"."amount_min_minor" is null or "categorization_rules"."amount_max_minor" is null or "categorization_rules"."amount_min_minor" <= "categorization_rules"."amount_max_minor");
