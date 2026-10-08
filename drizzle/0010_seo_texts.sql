-- The search engines' title and description of the home page (Settings → General →
-- Search engines) in Persian, Turkish and English, set with this deploy on the Limer
-- site only (a database whose brand is "Limer"); other databases are left as they
-- are. The title ends with the brand as each language writes it (the "brand"
-- setting); it replaces what was there, and the audit row ("setting.update" of
-- "seo", without an admin) keeps the old texts. Running it again changes nothing.
WITH "brand" AS (
  SELECT coalesce(nullif(btrim("value"->>'fa'), ''), nullif(btrim("value"->>'tr'), ''), "value"->>'en') AS "fa",
         coalesce(nullif(btrim("value"->>'tr'), ''), "value"->>'en') AS "tr",
         "value"->>'en' AS "en"
  FROM "settings" WHERE "key" = 'brand' AND "value"->>'en' = 'Limer'
),
"texts" AS (
  SELECT jsonb_build_object(
           'fa', 'ورکشاپ‌های شمع‌سازی، سفال و ماکرامه در استانبول · ' || "brand"."fa",
           'tr', 'İstanbul’da Mum, Seramik ve Makrome Atölyeleri · ' || "brand"."tr",
           'en', 'Candle, Ceramics & Macramé Workshops in Istanbul · ' || "brand"."en") AS "title",
         jsonb_build_object(
           'fa', 'شمع‌سازی، سفال و ماکرامه را در ورکشاپ‌های کوچک و صمیمی در استانبول یاد بگیرید؛ با مدرس‌های باتجربه و بدون نیاز به تجربهٔ قبلی. اثرتان را به خانه ببرید.',
           'tr', 'İstanbul’da küçük ve samimi atölyelerde mum yapımı, seramik ve makrome öğrenin. Deneyimli eğitmenler, hazır malzemeler; önceden deneyim gerekmez.',
           'en', 'Learn candle making, ceramics and macramé in small, friendly workshops in Istanbul. Experienced instructors, materials ready, no experience needed.') AS "description"
  FROM "brand"
),
"old" AS (SELECT coalesce((SELECT "value" FROM "settings" WHERE "key" = 'seo'), '{}'::jsonb) AS "value"),
"next" AS (
  SELECT "old"."value" || jsonb_build_object(
           'title', coalesce("old"."value"->'title', '{}'::jsonb) || "texts"."title",
           'description', coalesce("old"."value"->'description', '{}'::jsonb) || "texts"."description") AS "value"
  FROM "old", "texts"
),
"saved" AS (
  INSERT INTO "settings" ("key", "value") SELECT 'seo', "value" FROM "next"
  ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updated_at" = now()
    WHERE "settings"."value" IS DISTINCT FROM EXCLUDED."value"
  RETURNING "value"
)
INSERT INTO "audit_log" ("action", "entity", "entity_id", "data")
SELECT 'setting.update', 'setting', 'seo', jsonb_build_object(
  'title', jsonb_build_object('from', coalesce("old"."value"->'title', '{}'::jsonb), 'to', "saved"."value"->'title'),
  'description', jsonb_build_object('from', coalesce("old"."value"->'description', '{}'::jsonb), 'to', "saved"."value"->'description'),
  'source', 'drizzle/0010_seo_texts.sql')
FROM "saved", "old";
