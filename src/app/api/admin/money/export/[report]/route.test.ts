import { and, desc, eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import { db } from "@/db"
import { auditLog } from "@/db/schema"
import { postContribution } from "@/features/money/ledger"
import { makeAdmin, retireAdmins } from "@/features/money/testing"
import { GET } from "./route"

vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl")
  const messages = {
    money: (await import("../../../../../../../messages/en/money.json")).default,
    workshops: (await import("../../../../../../../messages/en/workshops.json")).default,
  }
  return { getTranslations: async () => createTranslator({ locale: "en", messages }) }
})

const state = vi.hoisted(() => ({ admin: null as null | { id: string } }))
const session = () => (state.admin ? { sessionId: "s", admin: { id: state.admin.id, email: "e", name: "Export", shareBp: 0 } } : null)
vi.mock("@/lib/auth/admin", () => ({
  requireAdminApi: async () => session(),
  requireAdmin: async () => session(),
  getAdmin: async () => session(),
}))

/** The CSV lines; the file must start with a UTF-8 BOM (Excel needs it), which decoding removes. */
async function csvLines(response: Response) {
  const bytes = new Uint8Array(await response.arrayBuffer())
  expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
  return new TextDecoder().decode(bytes).trimEnd().split("\r\n")
}

const call = (report: string, query: string) =>
  GET(new Request(`http://localhost/api/admin/money/export/${report}?${query}`), { params: Promise.resolve({ report }) })

let partner: { id: string; name: string }

beforeAll(async () => {
  partner = await makeAdmin("Export Partner")
  await db.transaction((tx) =>
    postContribution(tx, {
      partnerId: partner.id,
      amount: 123456,
      occurredOn: "2004-02-03",
      description: "=HYPERLINK(\"http://evil\")",
      createdBy: partner.id,
    }),
  )
})

afterAll(async () => {
  await retireAdmins([partner.id])
})

describe("GET /api/admin/money/export/[report]", () => {
  it("refuses people who are not signed in", async () => {
    state.admin = null
    expect((await call("pnl", "from=2004-01-01&to=2004-12-31")).status).toBe(401)
  })

  it("answers 404 for an unknown report or a missing partner", async () => {
    state.admin = { id: partner.id }
    expect((await call("secrets", "")).status).toBe(404)
    expect((await call("partner", "from=2004-01-01&to=2004-12-31")).status).toBe(404)
  })

  it("exports a partner statement as safe CSV and audits it", async () => {
    state.admin = { id: partner.id }
    const response = await call("partner", `from=2004-01-01&to=2004-12-31&partner=${partner.id}&locale=en`)
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8")
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="partner_2004-01-01_2004-12-31.csv"')
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(await csvLines(response)).toEqual([
      "Export Partner",
      "Date,Type,Description,Workshop,Amount,Balance",
      "2004-01-01,Opening balance,,,,0",
      `2004-02-03,Capital contribution,"'=HYPERLINK(""http://evil"")",,1234.56,1234.56`,
      "2004-12-31,Closing balance,,,,1234.56",
    ])
    const [entry] = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.adminId, partner.id), eq(auditLog.action, "money.export")))
      .orderBy(desc(auditLog.at))
      .limit(1)
    expect(entry).toMatchObject({ entity: "report", entityId: "partner", data: { from: "2004-01-01", to: "2004-12-31" } })
  })

  it("writes Persian dates and periods in the Solar Hijri calendar", async () => {
    state.admin = { id: partner.id }
    const statement = await csvLines(await call("partner", `from=2004-01-01&to=2004-12-31&partner=${partner.id}&locale=fa`))
    // 3 Feb 2004 is 14 Bahman 1382; Latin digits, year first, so the column sorts.
    expect(statement.slice(2).map((line) => line.split(",")[0])).toEqual(["1382/10/11", "1382/11/14", "1383/10/11"])
    const pnl = await csvLines(await call("pnl", "from=2004-01-01&to=2004-12-31&group=month&locale=fa"))
    // Thirteen Jalali months touch 2004, each by its first day: Dey 1382 (from 22 Dec 2003) to Dey 1383 (from 21 Dec 2004).
    const periods = pnl.slice(1, -1).map((line) => line.split(",")[0])
    expect(periods).toHaveLength(13)
    expect([periods[0], periods[1], periods[12]]).toEqual(["1382/10/01", "1382/11/01", "1383/10/01"])
    const seasons = await csvLines(await call("pnl", "from=2004-01-01&to=2004-12-31&group=quarter&locale=fa"))
    // Winter 1382 (from 1 Dey), then spring, summer, autumn and winter of 1383 (Nowruz: 20 Mar 2004).
    expect(seasons.slice(1, -1).map((line) => line.split(",")[0])).toEqual(["1382/10/01", "1383/01/01", "1383/04/01", "1383/07/01", "1383/10/01"])
    // Turkish and English keep ISO days and Gregorian quarters.
    const quarters = await csvLines(await call("pnl", "from=2004-01-01&to=2004-12-31&group=quarter&locale=en"))
    expect(quarters.slice(1, -1).map((line) => line.split(",")[0])).toEqual(["2004-01-01", "2004-04-01", "2004-07-01", "2004-10-01"])
  })

  it("exports the ledger line by line, filtered", async () => {
    state.admin = { id: partner.id }
    const response = await call("transactions", `from=2004-01-01&to=2004-12-31&partner=${partner.id}&kind=nonsense`)
    const lines = await csvLines(response)
    expect(lines[0]).toBe("Date,Entry,Type,Description,Workshop,Account,Partner,Debit,Credit")
    expect(lines).toHaveLength(3)
    expect(lines[1]).toMatch(/^2004-02-03,[0-9a-f-]{36},Capital contribution,.*,,Wallet,,1234\.56,$/)
    expect(lines[2]).toMatch(/,Partner capital,Export Partner,,1234\.56$/)
  })
})
