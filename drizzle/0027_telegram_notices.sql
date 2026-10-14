CREATE TABLE "telegram_notices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"registration_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"chat_id" text NOT NULL,
	"message_id" integer NOT NULL,
	"format" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "telegram_notices" ADD CONSTRAINT "telegram_notices_registration_id_registrations_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."registrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "telegram_notices_registration_idx" ON "telegram_notices" USING btree ("registration_id");