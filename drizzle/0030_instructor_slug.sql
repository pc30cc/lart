ALTER TABLE "instructors" ADD COLUMN "slug" text;--> statement-breakpoint
-- The base of an instructor's slug from their English or Turkish name: lower-case a-z, 0-9 and single
-- hyphens, Turkish letters without their marks, "instructor" for a name without Latin letters.
CREATE OR REPLACE FUNCTION instructor_slug_base(name jsonb) RETURNS text AS $$
DECLARE
  base text;
BEGIN
  base := lower(translate(
    coalesce(nullif(trim(name->>'en'), ''), nullif(trim(name->>'tr'), ''), ''),
    'İIıÇĞÖŞÜçğöşüÂâÎîÛûÉéÈèÁáÀàÓóÍíÚúÑñÄäËë',
    'iiicgosucgosuaaiiuueeeeaaaaooiiuunnaaee'));
  base := trim(both '-' from left(trim(both '-' from regexp_replace(base, '[^a-z0-9]+', '-', 'g')), 60));
  RETURN CASE WHEN base = '' THEN 'instructor' ELSE base END;
END
$$ LANGUAGE plpgsql IMMUTABLE;--> statement-breakpoint
-- A free slug for a new instructor: the base, else "base-2", "base-3"…
CREATE OR REPLACE FUNCTION instructor_slug_for(name jsonb, self uuid) RETURNS text AS $$
DECLARE
  base text := instructor_slug_base(name);
  candidate text := base;
  n int := 1;
BEGIN
  -- One new instructor per base name at a time: the next one sees this one's slug once it is saved.
  PERFORM pg_advisory_xact_lock(hashtext('instructor-slug:' || base));
  WHILE EXISTS (SELECT 1 FROM instructors WHERE slug = candidate AND id IS DISTINCT FROM self) LOOP
    n := n + 1;
    candidate := base || '-' || n;
  END LOOP;
  RETURN candidate;
END
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE OR REPLACE FUNCTION instructors_set_slug() RETURNS trigger AS $$
BEGIN
  IF NEW.slug IS NULL OR NEW.slug = '' THEN
    NEW.slug := instructor_slug_for(NEW.display_name, NEW.id);
  END IF;
  RETURN NEW;
END
$$ LANGUAGE plpgsql;--> statement-breakpoint
-- The instructors there already, oldest first: the base, then "-2", "-3"… for the same base.
UPDATE instructors i SET slug = CASE WHEN s.n = 1 THEN s.base ELSE s.base || '-' || s.n END
FROM (
  SELECT id, instructor_slug_base(display_name) AS base,
    row_number() OVER (PARTITION BY instructor_slug_base(display_name) ORDER BY created_at, id) AS n
  FROM instructors
) s
WHERE s.id = i.id;--> statement-breakpoint
ALTER TABLE "instructors" ALTER COLUMN "slug" SET DEFAULT '';--> statement-breakpoint
ALTER TABLE "instructors" ALTER COLUMN "slug" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "instructors" ADD CONSTRAINT "instructors_slug_unique" UNIQUE("slug");--> statement-breakpoint
CREATE TRIGGER instructors_slug BEFORE INSERT OR UPDATE OF slug ON instructors FOR EACH ROW EXECUTE FUNCTION instructors_set_slug();
