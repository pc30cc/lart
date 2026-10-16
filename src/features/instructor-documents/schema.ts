import { z } from "zod"

import { uuid } from "@/components/admin/form/schemas"
import { isSafePath } from "@/lib/storage/shared"

/**
 * An instructor's certificates and licences (client-safe: the panel's form
 * uses these for instant feedback, the actions for the real check).
 */

/** Documents one instructor may keep. */
export const MAX_DOCUMENTS = 20
export const DOCUMENT_PREFIX = "instructors/"

/** "۱۴۰۰" or "٢٠٢١" → "1400", "2021". */
const latinDigits = (v: string) => v.replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x6f0)).replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660))

const text = (max: number, error: string) => z.string().trim().max(max, { error })

export const documentDetailsSchema = z.object({
  title: z
    .string()
    .trim()
    .min(2, { error: "instructorPanel.documents.errors.title" })
    .max(120, { error: "instructorPanel.documents.errors.title" }),
  issuer: text(120, "instructorPanel.documents.errors.issuer").default(""),
  /** The year it was given, or null. */
  year: z
    .preprocess(
      // Persian and Arabic digits typed on a phone count too.
      (v) => (typeof v === "string" ? latinDigits(v.trim()) : v),
      z.union([z.literal(""), z.null(), z.coerce.number().int().min(1950).max(2100)], { error: "instructorPanel.documents.errors.year" }),
    )
    .transform((v) => (v === "" || v === null ? null : v))
    .default(null),
  description: text(600, "instructorPanel.documents.errors.description").default(""),
})

/** A new document: the file the instructor just uploaded (`/api/instructor/uploads`) and its details. */
export const addDocumentSchema = documentDetailsSchema.extend({
  path: z.string().refine((v) => isSafePath(v) && v.startsWith(DOCUMENT_PREFIX) && /\/doc-[\w-]+\.(webp|pdf)$/.test(v), {
    error: "instructorPanel.documents.errors.file",
  }),
})
export type AddDocumentValues = z.input<typeof addDocumentSchema>

export const editDocumentSchema = documentDetailsSchema.extend({ id: uuid() })
export type EditDocumentValues = z.input<typeof editDocumentSchema>

export const documentIdSchema = z.object({ id: uuid() })
