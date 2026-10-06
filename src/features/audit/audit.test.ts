import { randomUUID } from "node:crypto"
import { beforeAll, describe, expect, it, vi } from "vitest"

import { parseTableParams, type SearchParams } from "@/components/admin/data-table/params"
import { db } from "@/db"
import { admins, auditLog } from "@/db/schema"
import { auditDetail, auditSummary } from "./format"
import { auditTable, getAuditFilterOptions, listAudit } from "./queries"
import { nextDay, parseDateRange, shiftDay, validDate } from "./range"

const session = vi.hoisted(() => ({ sessionId: "test", admin: { id: "", email: "", name: "Audit Tester", shareBp: 0 } }))
vi.mock("@/lib/auth/admin", () => ({ requireAdmin: async () => session, getAdmin: async () => session }))

describe("audit data formatting", () => {
  it("summarises changes, localized texts and long values on one line", () => {
    expect(auditSummary(null)).toBe("")
    expect(auditSummary({ slug: { from: "candles", to: "candle-making" }, sort: { from: 1, to: 2 } })).toBe(
      "slug: candles → candle-making · sort: 1 → 2",
    )
    expect(auditSummary({ name: { fa: "شمع", tr: "Mum" }, logoPath: { from: null, to: "brand/x.png" } })).toBe(
      "name: شمع · logoPath: — → brand/x.png",
    )
    expect(auditSummary({ keysReplaced: ["publicZoneKey", "privateZoneKey"] })).toBe("keysReplaced: publicZoneKey, privateZoneKey")
    const long = auditSummary({ body: { from: { en: "x".repeat(500) }, to: { en: "y".repeat(500) } }, more: "z".repeat(500) })
    expect(long.length).toBeLessThanOrEqual(140)
    expect(long.endsWith("…")).toBe(true)
  })

  it("keeps the details readable and bounded", () => {
    const detail = auditDetail({ body: { from: { en: "a".repeat(5000) } }, n: 1 })
    expect(detail).toContain(`"n": 1`)
    expect(detail).toContain(`${"a".repeat(399)}…`)
    expect(detail).not.toContain("a".repeat(401))
    expect(auditDetail({ big: Array.from({ length: 200 }, () => "b".repeat(300)) }).length).toBeLessThanOrEqual(6000)
  })
})

describe("date range", () => {
  it("accepts real dates only and puts the ends in order", () => {
    expect(validDate("2026-02-29")).toBeUndefined()
    expect(validDate("2028-02-29")).toBe("2028-02-29")
    expect(validDate("2026-1-5")).toBeUndefined()
    expect(validDate(["2026-01-05"])).toBeUndefined()
    expect(parseDateRange({ from: "2026-10-06", to: "2026-10-01" })).toEqual({ from: "2026-10-01", to: "2026-10-06" })
    expect(parseDateRange({ from: "nope", to: "2026-10-01" })).toEqual({ to: "2026-10-01" })
    expect(parseDateRange({})).toEqual({})
    expect(nextDay("2026-12-31")).toBe("2027-01-01")
    expect(shiftDay("2026-03-01", -1)).toBe("2026-02-28")
  })
})

describe("listAudit", () => {
  const run = randomUUID().slice(0, 8)
  const entity = `test_${run}`
  const other = `other_${run}`
  let adminA: string
  let adminB: string

  beforeAll(async () => {
    const [a, b] = await db
      .insert(admins)
      .values([
        { email: `audit-a-${run}@test.local`, name: `Ayla ${run}`, passwordHash: "x", active: false },
        { email: `audit-b-${run}@test.local`, name: `Bora ${run}`, passwordHash: "x", active: false },
      ])
      .returning()
    adminA = a.id
    adminB = b.id
    Object.assign(session.admin, { id: a.id, email: a.email })
    // Istanbul is UTC+3: 21:30 UTC on 9 March is already 10 March there.
    await db.insert(auditLog).values([
      { adminId: adminA, action: `${entity}.create`, entity, entityId: "one", data: { note: "100% done" }, at: new Date("2026-03-09T20:30:00Z") },
      { adminId: adminA, action: `${entity}.update`, entity, entityId: "two", data: { note: "plain" }, at: new Date("2026-03-09T21:30:00Z") },
      { adminId: adminB, action: `${entity}.delete`, entity, entityId: "three", data: null, at: new Date("2026-03-10T20:59:00Z") },
      { adminId: null, action: `${other}.create`, entity: other, entityId: "four", data: null, at: new Date("2026-03-10T21:00:00Z") },
    ])
  })

  // audit_log is append-only: these rows and their (inactive) admins stay in the test database.

  const list = (sp: SearchParams, filters = { admin: [adminA, adminB], entity: [entity, other] }) =>
    listAudit(
      parseTableParams(sp, { sort: auditTable.sort, defaultSort: "at", defaultDir: "desc", filters }),
      parseDateRange(sp),
    )
  const ids = (result: Awaited<ReturnType<typeof listAudit>>) => result.rows.map((r) => r.entityId)

  it("filters by admin and entity, newest first, with the admin's name", async () => {
    const byEntity = await list({ entity })
    expect(ids(byEntity)).toEqual(["three", "two", "one"])
    expect(byEntity.total).toBe(3)
    expect(byEntity.rows[0]).toMatchObject({ adminName: `Bora ${run}`, summary: "", detail: "" })
    expect(byEntity.rows[2]).toMatchObject({ summary: "note: 100% done" })
    expect(byEntity.rows[2]).not.toHaveProperty("data")

    expect(ids(await list({ entity, admin: adminA }))).toEqual(["two", "one"])
    expect(ids(await list({ q: other }))).toEqual(["four"])
    expect((await list({ q: other })).rows[0].adminName).toBeNull()
  })

  it("filters whole days in Istanbul time, both ends included", async () => {
    expect(ids(await list({ entity, from: "2026-03-10", to: "2026-03-10" }))).toEqual(["three", "two"])
    expect(ids(await list({ entity, to: "2026-03-09" }))).toEqual(["one"])
    expect(ids(await list({ q: run, from: "2026-03-11" }))).toEqual(["four"])
  })

  it("searches literally (no wildcards from the user) and sorts", async () => {
    expect(ids(await list({ entity, q: "100%" }))).toEqual(["one"])
    expect(ids(await list({ entity, q: "_" }))).toEqual(["three", "two", "one"]) // the action contains "_"
    expect(ids(await list({ entity, q: "%_%" }))).toEqual([])
    expect(ids(await list({ entity, q: `Bora ${run}` }))).toEqual(["three"])
    expect(ids(await list({ entity, sort: "action", dir: "asc" }))).toEqual(["one", "three", "two"])
  })

  it("offers every admin and every logged entity as filters", async () => {
    const options = await getAuditFilterOptions()
    expect(options.admins.map((a) => a.id)).toEqual(expect.arrayContaining([adminA, adminB]))
    expect(options.entities).toEqual(expect.arrayContaining([entity, other]))
  })

  it("ignores filter values that are not offered", async () => {
    const result = await list({ entity: "admins; drop table", admin: randomUUID() })
    expect(result.total).toBeGreaterThanOrEqual(4)
  })
})
