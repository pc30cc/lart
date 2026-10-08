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
    const tag = randomUUID().slice(0, 8)
    await partner({
      name: `Mina Rahimi ${tag}`,
      aboutShown: true,
      aboutName: { fa: `مینا رحیمی ${tag}` },
      aboutRole: { fa: "هم‌بنیان‌گذار", tr: "Kurucu ortak" },
      aboutBio: { fa: "سلام", tr: "Merhaba", en: "Hello" },
      portraitPath: `partners/mina/portrait-${tag}.webp`,
      createdAt: new Date("2000-01-01T00:00:00Z"),
    })
    await partner({ name: `Hidden ${tag}`, aboutShown: false, aboutBio: { fa: "x", tr: "x", en: "x" } })
    await partner({ name: `Gone ${tag}`, active: false, aboutShown: true, aboutBio: { fa: "x", tr: "x", en: "x" } })

    const mine = (list: { name: string }[]) => list.filter((p) => p.name.endsWith(tag))
    const fa = mine(await listAboutPartners("fa"))
    expect(fa).toEqual([
      {
        key: expect.stringMatching(/^partner-\d+$/),
        name: `مینا رحیمی ${tag}`,
        role: "هم‌بنیان‌گذار",
        bio: "سلام",
        portraitUrl: `https://cdn.test/partners/mina/portrait-${tag}.webp`,
      },
    ])
    // English: their profile's name, and no role (none written in English; never another language's).
    expect(mine(await listAboutPartners("en"))).toEqual([expect.objectContaining({ name: `Mina Rahimi ${tag}`, role: "", bio: "Hello" })])
    // Hidden and inactive partners are not listed; no internal id reaches the page.
    expect(mine(await listAboutPartners("tr")).map((p) => p.name)).toEqual([`Mina Rahimi ${tag}`])
    expect(JSON.stringify(await listAboutPartners("tr"))).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/)
  })
})
