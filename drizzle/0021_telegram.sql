ALTER TABLE "admin_notifications" DROP CONSTRAINT "admin_notifications_kind";--> statement-breakpoint
ALTER TABLE "admin_notifications" ALTER COLUMN "registration_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "admin_notifications" ADD COLUMN "course_id" uuid;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "telegram_posted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "telegram_message_id" integer;--> statement-breakpoint
ALTER TABLE "admin_notifications" ADD CONSTRAINT "admin_notifications_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_notifications" ADD CONSTRAINT "admin_notifications_subject" CHECK (("admin_notifications"."registration_id" is not null) <> ("admin_notifications"."course_id" is not null));--> statement-breakpoint
ALTER TABLE "admin_notifications" ADD CONSTRAINT "admin_notifications_kind" CHECK ("admin_notifications"."kind" in ('registration', 'receipt', 'workshop'));