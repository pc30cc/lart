-- A document's title in Persian, Turkish and/or English; the earlier text goes to the language of its letters.
ALTER TABLE "instructor_documents" ALTER COLUMN "title" SET DATA TYPE jsonb USING jsonb_build_object(CASE WHEN "title" ~ '[؀-ۿ]' THEN 'fa' ELSE 'tr' END, "title");--> statement-breakpoint
ALTER TABLE "instructor_documents" DROP COLUMN "issuer";--> statement-breakpoint
ALTER TABLE "instructor_documents" DROP COLUMN "year";--> statement-breakpoint
ALTER TABLE "instructor_documents" DROP COLUMN "description";
