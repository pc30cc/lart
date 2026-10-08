-- Settings → Danger zone: "Delete all transactions" removes the ledger and the
-- money rows of the activity log. Ledger and audit rows stay append-only for
-- everything else: only a DELETE inside a transaction that set
-- `lart.factory_reset` to 'on' (SET LOCAL, features/settings/reset.ts) passes.
CREATE OR REPLACE FUNCTION forbid_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('lart.factory_reset', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'restrict_violation';
END $$;
