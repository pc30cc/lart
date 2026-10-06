-- The workshop venue becomes three-language text ({ fa, tr, en }) like the title.
-- Hand-edited: the generated statement had no USING clause. Existing venues
-- were typed by the admins in Turkish, so each one becomes { "tr": <venue> }.
ALTER TABLE "courses" ALTER COLUMN "venue" SET DATA TYPE jsonb USING jsonb_build_object('tr', "venue");
