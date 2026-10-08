-- The About page's own text (Settings → Home page → About page) on the Limer site only
-- (a database whose brand is "Limer"): the owner's Persian text, with Turkish and English
-- versions of it. Only while the page has no text of its own (an admin's text is never
-- replaced); the footer's short "About us" text stays as it is. Audited like a save of
-- the home page ("setting.update" of "home", without an admin). Running it again changes nothing.
WITH "text" AS (
  SELECT jsonb_build_object('fa', $about$LIMER از یک مکث آغاز شد.

مکثی کوتاه در میان شتاب روزمره؛ برای لمس کردن، ساختن و دوباره نزدیک شدن به بخش خلاق وجودمان.

LIMER فضایی‌ست برای کسانی که هنر را فقط به‌عنوان یک مهارت نمی‌بینند، بلکه به دنبال تجربه‌ای متفاوت، الهام‌بخش و لذت‌بخش هستند.

ما ورکشاپ‌ها و کلاس‌های هنری خصوصی و گروهی در زمینه‌هایی مانند سفال، نقاشی، شمع‌سازی، پتینه، گل‌آرایی، خوشنویسی و دیگر شاخه‌های هنر برگزار می‌کنیم؛ با تمرکز بر تجربه‌ای که در آن یادگیری با لذت و خلق کردن همراه می‌شود.

برای ما، هنر فقط ساختن یک اثر نیست؛ فرصتی‌ست برای آرام شدن، تجربه کردن، آزادانه خلق کردن و کشف توانایی‌هایی که شاید در روزمرگی فراموششان کرده‌ایم.

رؤیای ما ساختن فضایی زنده و الهام‌بخش است؛ جایی برای هنر، تجربه، آشنایی و خلق لحظاتی که ارزش به خاطر سپردن دارند.

لیمر؛ محل تلاقی الهام‌ها.$about$, 'tr', $about$LIMER bir duraklamayla başladı.

Gündelik hayatın telaşı içinde kısa bir duraklama: dokunmak, üretmek ve içimizdeki yaratıcı yana yeniden yaklaşmak için.

LIMER, sanatı yalnızca bir beceri olarak görmeyen; farklı, ilham verici ve keyifli bir deneyim arayanlar için bir alan.

Seramik, resim, mum yapımı, patina, çiçek düzenleme, hat ve sanatın diğer dallarında özel ve grup atölyeleri ile sanat dersleri düzenliyoruz; öğrenmenin keyifle ve üretmekle bir araya geldiği bir deneyime odaklanarak.

Bizim için sanat yalnızca bir eser ortaya koymak değil; sakinleşmek, deneyimlemek, özgürce üretmek ve gündelik koşturmacada belki unuttuğumuz yetenekleri keşfetmek için bir fırsat.

Hayalimiz canlı ve ilham verici bir alan kurmak: sanata, deneyime, tanışmaya ve hatırlanmaya değer anlar yaratmaya yer açan bir yer.

Limer: ilhamların buluştuğu yer.$about$, 'en', $about$LIMER began with a pause.

A short pause in the rush of everyday life: to touch, to make, and to come close again to the creative part of ourselves.

LIMER is a space for people who see art as more than a skill, and who are looking for an experience that is different, inspiring and joyful.

We hold private and group art workshops and classes in pottery, painting, candle making, patina, flower arranging, calligraphy and other branches of art, focused on an experience where learning goes hand in hand with joy and making.

For us, art is not only about making a piece; it is a chance to slow down, to experience, to create freely, and to discover abilities we may have forgotten in our daily routine.

Our dream is to build a living, inspiring space: a place for art, experience, meeting people and creating moments worth remembering.

Limer: where inspirations meet.$about$) AS "value"
  WHERE EXISTS (SELECT 1 FROM "settings" WHERE "key" = 'brand' AND "value"->>'en' = 'Limer')
),
"old" AS (SELECT coalesce((SELECT "value" FROM "settings" WHERE "key" = 'home'), '{}'::jsonb) AS "value"),
"next" AS (
  SELECT "old"."value" || jsonb_build_object('aboutPage', jsonb_build_object('text', "text"."value")) AS "value"
  FROM "old", "text"
  WHERE coalesce("old"."value"->'aboutPage'->'text', '{}'::jsonb) = '{}'::jsonb
),
"saved" AS (
  INSERT INTO "settings" ("key", "value") SELECT 'home', "value" FROM "next"
  ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updated_at" = now()
    WHERE "settings"."value" IS DISTINCT FROM EXCLUDED."value"
  RETURNING "value"
)
INSERT INTO "audit_log" ("action", "entity", "entity_id", "data")
SELECT 'setting.update', 'setting', 'home', jsonb_build_object(
  'aboutPage.text', jsonb_build_object('from', '{}'::jsonb, 'to', "saved"."value"->'aboutPage'->'text'),
  'source', 'drizzle/0014_about_page_text.sql')
FROM "saved";
