import { randomUUID } from "node:crypto"
import { inArray } from "drizzle-orm"
import { afterAll, describe, expect, it, vi } from "vitest"

import { db } from "@/db"
import { admins } from "@/db/schema"
import { listAboutPartners } from "./about"

vi.mock("@/lib/storage", () => ({ publicUrls: async () => (path: string | null) => (path ? `https://cdn.test/${path}` : null) }))

const created: string[] = []

async function partner(values: Partial<typeof admins.$inferInsert>) {
  const [row] = await db
    .insert(admins)
    .values({ email: `about-${randomUUID().slice(0, 8)}@test.local`, name: "Partner", passwordHash: "x", ...values })
    .returning({ id: admins.id })
  created.push(row.id)
  return row.id
}

afterAll(async () => {
  await db.update(admins).set({ active: false, aboutShown: false }).where(inArray(admins.id, created))
})

describe("listAboutPartners", () => {
  it("lists active partners who chose to be shown, each text in the page's language only", async () => {
    const mina = await partner({
      name: "Mina Rahimi",
      aboutShown: true,
      aboutName: { fa: "مینا رحیمی" },
      aboutRole: { fa: "هم‌بنیان‌گذار", tr: "Kurucu ortak" },
      aboutBio: { fa: "سلام", tr: "Merhaba", en: "Hello" },
      portraitPath: "partners/mina/portrait-abc.webp",
      createdAt: new Date("2000-01-01T00:00:00Z"),
    })
    const hidden = await partner({ name: "Hidden", aboutShown: false, aboutBio: { fa: "x", tr: "x", en: "x" } })
    const gone = await partner({ name: "Gone", active: false, aboutShown: true, aboutBio: { fa: "x", tr: "x", en: "x" } })

    const ids = (list: { key: string }[]) => list.map((p) => p.key).filter((k) => created.includes(k))
    const fa = await listAboutPartners("fa")
    expect(ids(fa)).toEqual([mina])
    expect(fa.find((p) => p.key === mina)).toEqual({
      key: mina,
      name: "مینا رحیمی",
      role: "هم‌بنیان‌گذار",
      bio: "سلام",
      portraitUrl: "https://cdn.test/partners/mina/portrait-abc.webp",
    })
    // English: their profile's name, and no role (none written in English; never another language's).
    expect((await listAboutPartners("en")).find((p) => p.key === mina)).toMatchObject({ name: "Mina Rahimi", role: "", bio: "Hello" })
    expect(ids(await listAboutPartners("tr"))).not.toContain(hidden)
    expect(ids(await listAboutPartners("tr"))).not.toContain(gone)
  })
})
