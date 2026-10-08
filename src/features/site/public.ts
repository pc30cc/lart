import "server-only"

import type { PastWorkshop, PublicCategory } from "@/themes/types"

/**
 * Public data the themes show besides the workshop list: categories with open
 * workshops and finished workshops with their photos. Only public fields.
 */

/** Categories that have open workshops (as `listOpenWorkshops`), in the admin's order, with how many. */
export async function listPublicCategories(locale: string): Promise<PublicCategory[]> {
  void locale
  return [] // TODO(theme-data): implement
}

/** Finished (closed, not cancelled) workshops with a cover or gallery photos, newest first. */
export async function listPastWorkshops(locale: string, { limit = 8 }: { limit?: number } = {}): Promise<PastWorkshop[]> {
  void locale
  void limit
  return [] // TODO(theme-data): implement
}
