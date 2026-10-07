-- Gallery photos are stored only watermarked: the unwatermarked originals (in the
-- former private storage zone) are no longer kept or referenced.
ALTER TABLE "media" DROP COLUMN "original_path";
