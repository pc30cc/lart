import { describe, expect, it } from "vitest"

import { findNav } from "./nav"

const found = (pathname: string) => findNav(pathname)?.item.href ?? null

describe("findNav", () => {
  it("finds the item of a page and of the pages below it (the longest href wins)", () => {
    expect(found("/admin")).toBe("/admin")
    expect(found("/admin/workshops")).toBe("/admin/workshops")
    expect(found("/admin/workshops/123/edit")).toBe("/admin/workshops")
    expect(found("/admin/money")).toBe("/admin/money")
    expect(found("/admin/money/partners")).toBe("/admin/money/partners")
    expect(found("/admin/students")).toBe("/admin/students")
    expect(found("/admin/students/123")).toBe("/admin/students")
  })

  it("never makes an exact item a parent: a page outside the navigation has no item", () => {
    // My profile (from the user menu) is not below Dashboard.
    expect(found("/admin/profile")).toBeNull()
    expect(found("/admin/money/something-else")).toBeNull()
  })
})
