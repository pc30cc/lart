ALTER TABLE "admins" ADD COLUMN "about_shown" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "admins" ADD COLUMN "about_name" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "admins" ADD COLUMN "about_role" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "admins" ADD COLUMN "about_bio" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "admins" ADD COLUMN "portrait_path" text;