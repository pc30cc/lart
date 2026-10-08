-- The ledger and the activity log are append-only (0001, 0013): a row-level
-- trigger refuses UPDATE and DELETE. TRUNCATE fires no row trigger, so it is
-- refused here too; the factory reset deletes rows, it never truncates.
CREATE OR REPLACE FUNCTION forbid_truncate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'restrict_violation';
END $$;
--> statement-breakpoint
CREATE TRIGGER ledger_transactions_no_truncate BEFORE TRUNCATE ON ledger_transactions FOR EACH STATEMENT EXECUTE FUNCTION forbid_truncate();
--> statement-breakpoint
CREATE TRIGGER ledger_lines_no_truncate BEFORE TRUNCATE ON ledger_lines FOR EACH STATEMENT EXECUTE FUNCTION forbid_truncate();
--> statement-breakpoint
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON audit_log FOR EACH STATEMENT EXECUTE FUNCTION forbid_truncate();
