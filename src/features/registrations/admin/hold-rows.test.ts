import { describe, expect, it } from "vitest"

import { holdsForView, holdsOnPage } from "./hold-rows"

const holds = [
  { id: "a", day: null, note: "", count: 3 },
  { id: "b", day: 0, note: "Ipek", count: 1 },
  { id: "c", day: 1, note: "", count: 2 },
]

describe("held places in the registrations table", () => {
  it("are listed on every day's tab and on the whole list, never on a payment view", () => {
    expect(holdsForView(holds, {}).map((h) => h.id)).toEqual(["a", "b", "c"])
    expect(holdsForView(holds, { day: "0" }).map((h) => h.id)).toEqual(["a", "b"])
    expect(holdsForView(holds, { day: "1" }).map((h) => h.id)).toEqual(["c"])
    expect(holdsForView(holds, { status: "unpaid" })).toEqual([])
    expect(holdsForView(holds, { q: "ipe" }).map((h) => h.id)).toEqual(["b"])
  })

  it("come after the registrations, paged with them", () => {
    const page = (n: number) => ({ offset: (n - 1) * 50, pageSize: 50 })
    // 4 registrations: all holds on the first page.
    expect(holdsOnPage(holds, 4, 4, page(1))).toHaveLength(3)
    // 49 registrations: one hold fits on page 1, the other two on page 2.
    expect(holdsOnPage(holds, 49, 49, page(1)).map((h) => h.id)).toEqual(["a"])
    expect(holdsOnPage(holds, 49, 0, page(2)).map((h) => h.id)).toEqual(["b", "c"])
    // 50 registrations fill page 1: the holds start page 2.
    expect(holdsOnPage(holds, 50, 50, page(1))).toEqual([])
    expect(holdsOnPage(holds, 50, 0, page(2))).toHaveLength(3)
    // No registrations at all: the holds alone.
    expect(holdsOnPage(holds, 0, 0, page(1))).toHaveLength(3)
  })
})
