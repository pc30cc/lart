CREATE TABLE "seat_holds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_id" uuid NOT NULL,
	"day" integer,
	"count" integer NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seat_holds_count" CHECK ("seat_holds"."count" between 1 and 100)
);
--> statement-breakpoint
ALTER TABLE "seat_holds" ADD CONSTRAINT "seat_holds_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seat_holds" ADD CONSTRAINT "seat_holds_created_by_admins_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "seat_holds_course_idx" ON "seat_holds" USING btree ("course_id");