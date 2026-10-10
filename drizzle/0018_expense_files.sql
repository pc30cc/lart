CREATE TYPE "public"."expense_file_role" AS ENUM('receipt', 'photo');--> statement-breakpoint
CREATE TABLE "expense_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"role" "expense_file_role" NOT NULL,
	"path" text NOT NULL,
	"content_type" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expense_files_path_unique" UNIQUE("path")
);
--> statement-breakpoint
ALTER TABLE "ledger_transactions" ADD COLUMN "furnishing" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "expense_files" ADD CONSTRAINT "expense_files_transaction_id_ledger_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."ledger_transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_files" ADD CONSTRAINT "expense_files_created_by_admins_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "expense_files_tx_idx" ON "expense_files" USING btree ("transaction_id");