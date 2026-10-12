CREATE TABLE "page_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"path" text NOT NULL,
	"locale" text NOT NULL,
	"visitor" text NOT NULL,
	"referrer" text,
	"device" text NOT NULL,
	"country" text,
	CONSTRAINT "page_views_device" CHECK ("page_views"."device" in ('mobile', 'tablet', 'desktop'))
);
--> statement-breakpoint
CREATE INDEX "page_views_at_idx" ON "page_views" USING btree ("at");