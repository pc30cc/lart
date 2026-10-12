CREATE TABLE "admin_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"registration_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_notifications_kind" CHECK ("admin_notifications"."kind" in ('registration', 'receipt'))
);
--> statement-breakpoint
ALTER TABLE "admins" ADD COLUMN "notifications_seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "payment_choice" text;--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "receipt_path" text;--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "receipt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "admin_notifications" ADD CONSTRAINT "admin_notifications_registration_id_registrations_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."registrations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_notifications_created_idx" ON "admin_notifications" USING btree ("created_at");--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_payment_choice" CHECK ("registrations"."payment_choice" in ('cash', 'transfer', 'online'));