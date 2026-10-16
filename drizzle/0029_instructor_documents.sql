CREATE TABLE "instructor_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instructor_id" uuid NOT NULL,
	"path" text NOT NULL,
	"thumb_path" text,
	"content_type" text NOT NULL,
	"title" text NOT NULL,
	"issuer" text DEFAULT '' NOT NULL,
	"year" smallint,
	"description" text DEFAULT '' NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "instructor_documents" ADD CONSTRAINT "instructor_documents_instructor_id_instructors_id_fk" FOREIGN KEY ("instructor_id") REFERENCES "public"."instructors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "instructor_documents_instructor_idx" ON "instructor_documents" USING btree ("instructor_id");