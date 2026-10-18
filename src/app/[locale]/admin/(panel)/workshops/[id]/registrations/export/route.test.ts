import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import { db } from "@/db"
import { seatHolds } from "@/db/schema"
import { csvDate } from "@/features/money/csv"
import { addRegistration, makeAdmin, makeCourse, makeWorld, retireAdmins } from "@/features/money/testing"
import { zonedParts } from "@/lib/format"
import { GET } from "./route"

vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl")
  const load = async (locale: string) => (await import(`../../../../../../../../../messages/${locale}/workshops.json`)).default
  return {
    getTranslations: async ({ locale, namespace }: { locale: string; namespace: string }) =>
      createTranslator({ locale, messages: { workshops: await load(locale) }, namespace: namespace as never }),
  }
})

const state = vi.hoisted(() => ({ adminId: "" }))
const session = () => ({ sessionId: "s", admin: { id: state.adminId, email: "e", name: "Export", shareBp: 0 } })
vi.mock("@/lib/auth/admin", () => ({ requireAdminApi: async () => session(), requireAdmin: async () => session(), getAdmin: async () => session() }))

let courseId: string

beforeAll(async () => {
  state.adminId = (await makeAdmin("Registrations Export")).id
  const world = await makeWorld()
  courseId = await makeCourse(world, state.adminId)
  // Refunded on 8 Oct 2026, 10:00 in Istanbul: 16 Mehr 1405.
  await addRegistration(world, courseId, { refundAmount: 25000, refundedAt: new Date("2026-10-08T07:00:00Z") })
})

afterAll(async () => {
  await retireAdmins([state.adminId])
})

/** The cells of the first registration (no cell of this fixture holds a comma). */
async function firstRow(locale: string) {
  const response = await GET(new Request(`http://localhost/${locale}/admin/workshops/${courseId}/registrations/export`), {
    params: Promise.resolve({ locale, id: courseId }),
  })
  expect(response.status).toBe(200)
  const lines = (await response.text()).replace(/^﻿/, "").trimEnd().split("\r\n")
  expect(lines).toHaveLength(2)
  return lines[1].split(",")
}

describe("GET registrations CSV", () => {
  it("writes the dates in the language's calendar", async () => {
    const today = zonedParts(new Date()).date
    // Columns: … 7 paid on, 8 refund, 9 refunded on, … 12 registered on.
    const fa = await firstRow("fa")
    expect(fa[9]).toBe("1405/07/16")
    expect([fa[7], fa[12]]).toEqual([csvDate(today, "fa"), csvDate(today, "fa")])
    expect(fa[7]).toMatch(/^1[34]\d\d\/\d\d\/\d\d$/)
    const en = await firstRow("en")
    expect(en[9]).toBe("2026-10-08")
    expect([en[7], en[12]]).toEqual([today, today])
  })

  it("lists the held places and invited guests after the registrations, with how many places each", async () => {
    const world = await makeWorld()
    const held = await makeCourse(world, state.adminId)
    await addRegistration(world, held)
    await db.insert(seatHolds).values([
      { courseId: held, count: 3, note: "", createdBy: state.adminId },
      { courseId: held, count: 1, note: "Ipek", invited: true, createdBy: state.adminId },
    ])
    const response = await GET(new Request(`http://localhost/en/admin/workshops/${held}/registrations/export`), {
      params: Promise.resolve({ locale: "en", id: held }),
    })
    const lines = (await response.text()).replace(/^\uFEFF/, "").trimEnd().split("\r\n").map((l) => l.split(","))
    expect(lines).toHaveLength(4)
    expect(lines[0].at(-1)).toBe("Places")
    expect(lines[1].at(-1)).toBe("1")
    expect(lines[2][0]).toBe("Guests")
    expect(lines[2][4]).toBe("Place held")
    expect(lines[2].at(-1)).toBe("3")
    expect(lines[3][0]).toBe("Ipek")
    expect(lines[3][4]).toBe("Invited · free")
  })
})
