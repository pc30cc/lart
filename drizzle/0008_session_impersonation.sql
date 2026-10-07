ALTER TABLE "sessions" ADD COLUMN "impersonated_by" uuid;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_impersonated_by_admins_id_fk" FOREIGN KEY ("impersonated_by") REFERENCES "public"."admins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sessions_impersonated_by_idx" ON "sessions" USING btree ("impersonated_by");--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_impersonation_kind" CHECK ("sessions"."impersonated_by" is null or "sessions"."kind" <> 'admin');