import { z } from "zod"

import { localizedText, uuid } from "@/components/admin/form/schemas"
import { isSafePath } from "@/lib/storage/shared"

/**
 * An instructor's certificates and licences (client-safe: the panel's form
 * uses these for instant feedback, the actions for the real check). A
 * document is its file and a title, in Persian, Turkish and/or English.
 */

/** Documents one instructor may keep. */
export const MAX_DOCUMENTS = 20
export const DOCUMENT_PREFIX = "instructors/"

/** The title in at least one language, each at most 120 characters. */
const title = localizedText({ max: 120 }).refine((t) => Object.values(t).some((v) => (v ?? "").length >= 2), {
  error: "instructorPanel.documents.errors.title",
})

/** A new document: the file the instructor just uploaded (`/api/instructor/uploads`) and its title. */
export const addDocumentSchema = z.object({
  path: z.string().refine((v) => isSafePath(v) && v.startsWith(DOCUMENT_PREFIX) && /\/doc-[\w-]+\.(webp|pdf)$/.test(v), {
    error: "instructorPanel.documents.errors.file",
  }),
  title,
})
export type AddDocumentValues = z.input<typeof addDocumentSchema>

export const editDocumentSchema = z.object({ id: uuid(), title })
export type EditDocumentValues = z.input<typeof editDocumentSchema>

export const documentIdSchema = z.object({ id: uuid() })
