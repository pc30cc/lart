/**
 * Students (the `members` table) in the super-admin panel. Client-safe: the
 * list page and the admin components use these too.
 */
import { z } from "zod"

import { uuid } from "@/components/admin/form/schemas"

/** Sortable columns of the students list (`/admin/students`). */
export const studentTable = {
  sort: ["name", "createdAt", "registrations"] as const,
}

export const studentIdSchema = z.object({ id: uuid() })
