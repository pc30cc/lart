/**
 * Held places in a workshop's registrations table (client-safe, pure): they
 * take places like registrations, so the table lists them too and its
 * numbers match the site's and the workshops list's ("8 of 8").
 */

type Hold = { day: number | null; note: string }

/**
 * The holds the table shows for its current view: none on a payment view
 * (unpaid, paid, cancelled: holds are neither), the day's own on a day tab,
 * and only those whose name matches a search.
 */
export function holdsForView<H extends Hold>(holds: H[], view: { status?: string; day?: string; q?: string }): H[] {
  if (view.status) return []
  const day = view.day === undefined ? undefined : Number(view.day)
  const q = view.q?.trim().toLocaleLowerCase()
  return holds.filter((h) => (day === undefined || (h.day ?? 0) === day) && (!q || h.note.toLocaleLowerCase().includes(q)))
}

/**
 * The holds on this page of the table: the list is the registrations, then
 * the holds, paged together (`registrations`: their total; `shown`: how many
 * of them are on this page). Pass `registrations + holds.length` as the
 * table's total.
 */
export function holdsOnPage<H>(holds: H[], registrations: number, shown: number, page: { offset: number; pageSize: number }): H[] {
  const room = page.pageSize - shown
  if (room <= 0) return []
  const start = Math.max(0, page.offset - registrations)
  return holds.slice(start, start + room)
}
