ALTER TABLE "registrations" ADD COLUMN "day" smallint;--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_day" CHECK ("registrations"."day" between 0 and 13);