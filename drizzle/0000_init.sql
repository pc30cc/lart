CREATE TYPE "public"."ledger_account" AS ENUM('wallet', 'instructor_advance', 'instructor_payable', 'partner_capital', 'revenue', 'instructor_fees', 'course_expenses', 'general_expenses');--> statement-breakpoint
CREATE TYPE "public"."contract_status" AS ENUM('sent', 'signed', 'void');--> statement-breakpoint
CREATE TYPE "public"."course_status" AS ENUM('awaiting_signature', 'published', 'confirmed', 'cancelled', 'closed');--> statement-breakpoint
CREATE TYPE "public"."fee_type" AS ENUM('per_participant', 'fixed');--> statement-breakpoint
CREATE TYPE "public"."media_kind" AS ENUM('sample', 'gallery_photo', 'gallery_video');--> statement-breakpoint
CREATE TYPE "public"."principal_kind" AS ENUM('admin', 'instructor', 'member');--> statement-breakpoint
CREATE TYPE "public"."registration_status" AS ENUM('pending', 'confirmed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."template_kind" AS ENUM('terms', 'contract');--> statement-breakpoint
CREATE TYPE "public"."token_purpose" AS ENUM('verify_email', 'reset_password', 'invite');--> statement-breakpoint
CREATE TYPE "public"."ledger_transaction_kind" AS ENUM('capital_contribution', 'capital_withdrawal', 'expense', 'registration_payment', 'registration_refund', 'instructor_advance', 'instructor_payment', 'course_settlement', 'course_close', 'reversal');--> statement-breakpoint
CREATE TABLE "admins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"name" text NOT NULL,
	"share_bp" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"failed_logins" smallint DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admins_email_unique" UNIQUE("email"),
	CONSTRAINT "admins_share_bp_range" CHECK ("admins"."share_bp" between 0 and 10000)
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_id" uuid,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text,
	"data" jsonb,
	"ip" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" jsonb NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "categories_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_id" uuid NOT NULL,
	"version" smallint DEFAULT 1 NOT NULL,
	"instructor_id" uuid NOT NULL,
	"status" "contract_status" DEFAULT 'sent' NOT NULL,
	"template_id" uuid NOT NULL,
	"fee_type" "fee_type" NOT NULL,
	"fee_amount" bigint NOT NULL,
	"advance_amount" bigint DEFAULT 0 NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"signed_at" timestamp with time zone,
	"signed_name" text,
	"signed_locale" text,
	"signed_text" text,
	"signed_text_sha256" text,
	"signed_ip" text,
	"signed_user_agent" text,
	"voided_at" timestamp with time zone,
	CONSTRAINT "contracts_amounts" CHECK ("contracts"."fee_amount" >= 0 and "contracts"."advance_amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "courses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"status" "course_status" DEFAULT 'awaiting_signature' NOT NULL,
	"category_id" uuid NOT NULL,
	"instructor_id" uuid NOT NULL,
	"title" jsonb NOT NULL,
	"intro" jsonb,
	"includes" jsonb,
	"bring" jsonb,
	"notes" jsonb,
	"experience_required" boolean DEFAULT false NOT NULL,
	"experience_note" jsonb,
	"age_min" smallint,
	"age_max" smallint,
	"venue" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"min_capacity" smallint NOT NULL,
	"max_capacity" smallint NOT NULL,
	"price" bigint NOT NULL,
	"registration_deadline" timestamp with time zone NOT NULL,
	"decision_at" timestamp with time zone NOT NULL,
	"terms_template_id" uuid,
	"cover_path" text,
	"decision_notified_at" timestamp with time zone,
	"final_participants" smallint,
	"closed_totals" jsonb,
	"published_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "courses_slug_unique" UNIQUE("slug"),
	CONSTRAINT "courses_times" CHECK ("courses"."ends_at" > "courses"."starts_at"),
	CONSTRAINT "courses_capacity" CHECK ("courses"."min_capacity" >= 1 and "courses"."max_capacity" >= "courses"."min_capacity"),
	CONSTRAINT "courses_price" CHECK ("courses"."price" >= 0)
);
--> statement-breakpoint
CREATE TABLE "email_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"purpose" "token_purpose" NOT NULL,
	"kind" "principal_kind" NOT NULL,
	"subject_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "instructors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text,
	"official_name" text NOT NULL,
	"id_number_enc" text NOT NULL,
	"mobile" text NOT NULL,
	"display_name" jsonb NOT NULL,
	"teaching_field" jsonb NOT NULL,
	"bio" jsonb,
	"teaching_languages" text[] DEFAULT '{}'::text[] NOT NULL,
	"website" text,
	"photo_path" text,
	"active" boolean DEFAULT true NOT NULL,
	"email_verified_at" timestamp with time zone,
	"failed_logins" smallint DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "instructors_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "ledger_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"account" "ledger_account" NOT NULL,
	"partner_id" uuid,
	"amount" bigint NOT NULL,
	CONSTRAINT "ledger_lines_nonzero" CHECK ("ledger_lines"."amount" <> 0),
	CONSTRAINT "ledger_lines_partner" CHECK (("ledger_lines"."account" = 'partner_capital') = ("ledger_lines"."partner_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "ledger_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "ledger_transaction_kind" NOT NULL,
	"occurred_on" date NOT NULL,
	"description" text NOT NULL,
	"course_id" uuid,
	"registration_id" uuid,
	"reversal_of" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_transactions_reversal_of_unique" UNIQUE("reversal_of")
);
--> statement-breakpoint
CREATE TABLE "media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_id" uuid NOT NULL,
	"kind" "media_kind" NOT NULL,
	"path" text NOT NULL,
	"original_path" text,
	"width" integer,
	"height" integer,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"email_verified_at" timestamp with time zone,
	"failed_logins" smallint DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "members_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "registrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"participant_name" text NOT NULL,
	"status" "registration_status" DEFAULT 'pending' NOT NULL,
	"amount" bigint NOT NULL,
	"terms_template_id" uuid NOT NULL,
	"terms_sha256" text NOT NULL,
	"terms_accepted_at" timestamp with time zone NOT NULL,
	"photo_consent" boolean DEFAULT false NOT NULL,
	"video_consent" boolean DEFAULT false NOT NULL,
	"paid_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"refund_amount" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" "principal_kind" NOT NULL,
	"subject_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "template_kind" NOT NULL,
	"name" text NOT NULL,
	"body" jsonb NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_admin_id_admins_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_instructor_id_instructors_id_fk" FOREIGN KEY ("instructor_id") REFERENCES "public"."instructors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_template_id_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_instructor_id_instructors_id_fk" FOREIGN KEY ("instructor_id") REFERENCES "public"."instructors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_terms_template_id_templates_id_fk" FOREIGN KEY ("terms_template_id") REFERENCES "public"."templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_created_by_admins_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_lines" ADD CONSTRAINT "ledger_lines_transaction_id_ledger_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."ledger_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_lines" ADD CONSTRAINT "ledger_lines_partner_id_admins_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_transactions" ADD CONSTRAINT "ledger_transactions_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_transactions" ADD CONSTRAINT "ledger_transactions_registration_id_registrations_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."registrations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_transactions" ADD CONSTRAINT "ledger_transactions_created_by_admins_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_terms_template_id_templates_id_fk" FOREIGN KEY ("terms_template_id") REFERENCES "public"."templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_at_idx" ON "audit_log" USING btree ("at");--> statement-breakpoint
CREATE UNIQUE INDEX "contracts_course_version" ON "contracts" USING btree ("course_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "contracts_one_live_per_course" ON "contracts" USING btree ("course_id") WHERE "contracts"."status" <> 'void';--> statement-breakpoint
CREATE INDEX "courses_status_starts_idx" ON "courses" USING btree ("status","starts_at");--> statement-breakpoint
CREATE INDEX "ledger_lines_tx_idx" ON "ledger_lines" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "ledger_lines_account_idx" ON "ledger_lines" USING btree ("account","partner_id");--> statement-breakpoint
CREATE INDEX "ledger_tx_course_idx" ON "ledger_transactions" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX "ledger_tx_occurred_idx" ON "ledger_transactions" USING btree ("occurred_on");--> statement-breakpoint
CREATE INDEX "media_course_idx" ON "media" USING btree ("course_id","kind","sort");--> statement-breakpoint
CREATE INDEX "registrations_course_idx" ON "registrations" USING btree ("course_id","status");--> statement-breakpoint
CREATE INDEX "registrations_member_idx" ON "registrations" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "sessions_subject_idx" ON "sessions" USING btree ("kind","subject_id");--> statement-breakpoint
CREATE UNIQUE INDEX "templates_one_default_per_kind" ON "templates" USING btree ("kind") WHERE "templates"."is_default";