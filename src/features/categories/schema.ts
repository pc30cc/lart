import { z } from "zod"

import { localizedText, slug, uuid } from "@/components/admin/form/schemas"

/** Fields of a category, shared by the form (client) and the actions (server). */
export const categorySchema = z.object({
  name: localizedText({ required: ["fa", "tr", "en"], max: 80 }),
  slug: slug(),
  sort: z.coerce.number().int().min(0).max(10_000),
})

export const categoryUpdateSchema = categorySchema.extend({ id: uuid() })
export const categoryIdSchema = z.object({ id: uuid() })

export type CategoryFormValues = z.input<typeof categorySchema>

/** List page: sortable columns and filters (validated by parseTableParams). */
export const categoryTable = {
  sort: ["sort", "name", "workshops"] as const,
  filters: { usage: ["used", "unused"] as const },
}
