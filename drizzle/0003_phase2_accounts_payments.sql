ALTER TABLE "instructors" ADD COLUMN "locale" text DEFAULT 'tr' NOT NULL;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "locale" text DEFAULT 'tr' NOT NULL;--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "hold_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "payment_provider" text;--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "payment_ref" text;--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "refunded_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "registrations_payment_ref" ON "registrations" USING btree ("payment_provider","payment_ref");--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_amounts" CHECK ("registrations"."amount" >= 0 and coalesce("registrations"."refund_amount", 0) between 0 and "registrations"."amount");--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_provider" CHECK ("registrations"."payment_provider" in ('iyzico', 'paytr', 'manual', 'test'));