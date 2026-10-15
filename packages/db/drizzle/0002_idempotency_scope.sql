-- Stored idempotency responses are disposable (24 h replay window) and nothing wrote them before
-- this migration. Clearing them lets the NOT NULL id/user_id columns be added (ADR 0010).
DELETE FROM "idempotency_keys";--> statement-breakpoint
ALTER TABLE "idempotency_keys" DROP CONSTRAINT "idempotency_keys_org_id_key_pk";--> statement-breakpoint
ALTER TABLE "idempotency_keys" ALTER COLUMN "org_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD COLUMN "id" uuid PRIMARY KEY NOT NULL;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD COLUMN "user_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idempotency_keys_created_at_idx" ON "idempotency_keys" USING btree ("created_at");--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_scope_key_uq" UNIQUE NULLS NOT DISTINCT("org_id","user_id","key");