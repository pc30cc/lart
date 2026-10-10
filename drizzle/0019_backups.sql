CREATE TYPE "public"."backup_kind" AS ENUM('auto', 'manual', 'monthly');--> statement-breakpoint
CREATE TABLE "backups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "backup_kind" NOT NULL,
	"path" text NOT NULL,
	"size" integer NOT NULL,
	"day" date NOT NULL,
	"month" date,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "backups_path_unique" UNIQUE("path")
);
--> statement-breakpoint
ALTER TABLE "backups" ADD CONSTRAINT "backups_created_by_admins_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "backups_day_idx" ON "backups" USING btree ("day");