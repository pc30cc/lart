-- Ledger safety rails, enforced by the database itself.

-- 1. Ledger and audit rows are append-only: corrections are reversals.
CREATE FUNCTION forbid_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'restrict_violation';
END $$;
--> statement-breakpoint
CREATE TRIGGER ledger_transactions_append_only BEFORE UPDATE OR DELETE ON ledger_transactions
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
--> statement-breakpoint
CREATE TRIGGER ledger_lines_append_only BEFORE UPDATE OR DELETE ON ledger_lines
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
--> statement-breakpoint
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
--> statement-breakpoint

-- 2. Every transaction balances (lines sum to zero) and has at least two lines.
--    Checked at commit, so lines can be inserted one by one in a transaction.
CREATE FUNCTION check_ledger_balance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  total bigint;
  n int;
BEGIN
  SELECT coalesce(sum(amount), 0), count(*) INTO total, n
    FROM ledger_lines WHERE transaction_id = NEW.transaction_id;
  IF total <> 0 OR n < 2 THEN
    RAISE EXCEPTION 'ledger transaction % is unbalanced (sum %, lines %)', NEW.transaction_id, total, n
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER ledger_lines_balanced AFTER INSERT ON ledger_lines
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_ledger_balance();
--> statement-breakpoint

-- 3. A transaction without lines is also rejected at commit.
CREATE FUNCTION check_ledger_has_lines() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM ledger_lines WHERE transaction_id = NEW.id) THEN
    RAISE EXCEPTION 'ledger transaction % has no lines', NEW.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER ledger_transactions_have_lines AFTER INSERT ON ledger_transactions
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_ledger_has_lines();
