ALTER TABLE "registrations" DROP CONSTRAINT "registrations_payment_method";--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "payment_url" text;--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_payment_method" CHECK ("registrations"."payment_method" in ('cash', 'transfer', 'online'));