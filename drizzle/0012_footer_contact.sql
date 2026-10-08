-- The footer's ways in touch (Settings → Home page → Footer) on the Limer site only (a
-- database whose brand is "Limer"): the email address, phone number and Instagram the
-- owner gave. The rest of the home page's content is kept as it is (a site that never
-- saved the home page gets just these; every other part parses to its default). The
-- site shows the email and phone concealed from spam harvesters (lib/conceal).
-- Audited like a save of the home page ("setting.update" of "home", without an admin).
-- Running it again changes nothing.
WITH "contact" AS (
  SELECT '{"email": "hello@limer.tr", "phone": "+90 535 418 85 05", "instagram": "https://instagram.com/limer_arthouse"}'::jsonb AS "value"
  WHERE EXISTS (SELECT 1 FROM "settings" WHERE "key" = 'brand' AND "value"->>'en' = 'Limer')
),
"old" AS (SELECT coalesce((SELECT "value" FROM "settings" WHERE "key" = 'home'), '{}'::jsonb) AS "value"),
"next" AS (
  SELECT "old"."value" || jsonb_build_object('footer', coalesce("old"."value"->'footer', '{}'::jsonb) || "contact"."value") AS "value"
  FROM "old", "contact"
),
"saved" AS (
  INSERT INTO "settings" ("key", "value") SELECT 'home', "value" FROM "next"
  ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updated_at" = now()
    WHERE "settings"."value" IS DISTINCT FROM EXCLUDED."value"
  RETURNING "value"
)
INSERT INTO "audit_log" ("action", "entity", "entity_id", "data")
SELECT 'setting.update', 'setting', 'home', jsonb_build_object(
  'footer.email', jsonb_build_object('from', coalesce("old"."value"->'footer'->>'email', ''), 'to', "saved"."value"->'footer'->>'email'),
  'footer.phone', jsonb_build_object('from', coalesce("old"."value"->'footer'->>'phone', ''), 'to', "saved"."value"->'footer'->>'phone'),
  'footer.instagram', jsonb_build_object('from', coalesce("old"."value"->'footer'->>'instagram', ''), 'to', "saved"."value"->'footer'->>'instagram'),
  'source', 'drizzle/0012_footer_contact.sql')
FROM "saved", "old";
