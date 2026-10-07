ALTER TABLE "instructors" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
-- Every instructor so far was added by an admin: approved from the start.
UPDATE "instructors" SET "approved_at" = "created_at" WHERE "approved_at" IS NULL;
