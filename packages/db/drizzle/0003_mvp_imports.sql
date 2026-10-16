ALTER TABLE "import_batches" ALTER COLUMN "file_key" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "import_batches" ADD COLUMN "warnings" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "import_batches" ADD COLUMN "period_from" date;--> statement-breakpoint
ALTER TABLE "import_batches" ADD COLUMN "period_to" date;--> statement-breakpoint
ALTER TABLE "import_rows" ADD COLUMN "document_number" text;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_org_iban_currency_uq" ON "accounts" USING btree ("org_id","iban","currency") WHERE "accounts"."iban" is not null;