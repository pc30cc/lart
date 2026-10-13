ALTER TABLE "ledger_transactions" ADD COLUMN "edit_of" uuid;--> statement-breakpoint
ALTER TABLE "ledger_transactions" ADD CONSTRAINT "ledger_transactions_edit_of_unique" UNIQUE("edit_of");