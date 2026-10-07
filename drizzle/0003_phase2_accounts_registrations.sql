ALTER TABLE "instructors" ADD COLUMN "locale" text DEFAULT 'tr' NOT NULL;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "locale" text DEFAULT 'tr' NOT NULL;--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "payment_method" text;--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "refunded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "reminder_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_amounts" CHECK ("registrations"."amount" >= 0 and coalesce("registrations"."refund_amount", 0) between 0 and "registrations"."amount");--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_payment_method" CHECK ("registrations"."payment_method" in ('cash', 'transfer'));