CREATE TABLE "ledger_discrepancies" (
	"transaction_id" uuid PRIMARY KEY NOT NULL,
	"reason" text NOT NULL,
	"recorded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ledger_discrepancies" ADD CONSTRAINT "ledger_discrepancies_transaction_id_ledger_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."ledger_transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_discrepancies" ADD CONSTRAINT "ledger_discrepancies_recorded_by_admins_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;