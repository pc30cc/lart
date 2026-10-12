import { randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { and, eq } from "drizzle-orm"
import sharp from "sharp"
import { afterAll, describe, expect, it, vi } from "vitest"

import { db } from "@/db"
import { admins, templates } from "@/db/schema"
import { defaultText } from "@/features/templates/seed"

const files = vi.hoisted(() => new Map<string, Buffer>())
vi.mock("@/lib/storage", async (load) => ({
  ...(await load<typeof import("@/lib/storage")>()),
  getStorage: async () => ({
    put: async (path: string, body: Uint8Array) => void files.set(path, Buffer.from(body)),
    read: async () => null,
    remove: async () => {},
    publicUrl: (path: string) => `https://cdn.test/${path}`,
  }),
}))

const { placeStartupContent, PORTRAITS } = await import("./startup-content")

// A partner of this test only, with a photo of its own (a new one each run).
const partner = { id: randomUUID(), name: "Portrait Test", file: "portrait-test.jpg", folder: "portrait-test" }

afterAll(async () => {
  await db.update(admins).set({ active: false, aboutShown: false }).where(eq(admins.id, partner.id))
})

async function contentRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "content-"))
  await mkdir(path.join(root, "content/partners"), { recursive: true })
  const colour = { r: Math.floor(Math.random() * 256), g: 80, b: 60 }
  const jpeg = await sharp({ create: { width: 300, height: 500, channels: 3, background: colour } }).jpeg().toBuffer()
  await writeFile(path.join(root, "content/partners", partner.file), jpeg)
  return root
}

describe("placeStartupContent", () => {
  it("ships a photo for every portrait it names", async () => {
    for (const p of PORTRAITS) await expect(sharp(path.join(process.cwd(), "content/partners", p.file)).metadata()).resolves.toMatchObject({ format: "jpeg" })
  })

  it("does nothing where the partner's row is not there", async () => {
    expect(await placeStartupContent(await contentRoot(), [partner])).toBe(0)
    expect(files.size).toBe(0)
  })

  it("stores the portrait once and shows the partner on the Our story page", async () => {
    await db.insert(admins).values({ id: partner.id, email: `portrait-${partner.id}@test.local`, name: partner.name, passwordHash: "x" })
    const root = await contentRoot()
    expect(await placeStartupContent(root, [partner])).toBe(1)
    const [row] = await db.select({ portraitPath: admins.portraitPath, aboutShown: admins.aboutShown }).from(admins).where(eq(admins.id, partner.id))
    expect(row.aboutShown).toBe(true)
    expect(row.portraitPath).toMatch(/^partners\/portrait-test\/portrait-[A-Za-z0-9_-]+\.webp$/)
    expect(files.get(row.portraitPath!)?.subarray(8, 12).toString("ascii")).toBe("WEBP")
    // Once per photo: a later start changes nothing.
    expect(await placeStartupContent(root, [partner])).toBe(0)
    expect(files.size).toBe(1)
  }, 30_000)

  it("gives the default terms the new text while they are still the earlier bundled one, never an edited text", async () => {
    const where = and(eq(templates.kind, "terms"), eq(templates.isDefault, true))
    const [before] = await db.select({ body: templates.body }).from(templates).where(where)
    // The earlier bundled texts, as the live site's default terms still were.
    const fixture = (l: string) => readFileSync(path.join(process.cwd(), "tests/fixtures", `old-terms.${l}.md`), "utf8").trim()
    const old = { fa: fixture("fa"), tr: fixture("tr"), en: fixture("en") }
    try {
      await db.update(templates).set({ body: old }).where(where)
      await placeStartupContent(await contentRoot(), [])
      const [now] = await db.select({ body: templates.body }).from(templates).where(where)
      expect(now.body).toEqual(defaultText("terms"))

      const edited = { ...old, fa: `${old.fa}\n- یک بند تازه` }
      await db.update(templates).set({ body: edited }).where(where)
      await placeStartupContent(await contentRoot(), [])
      const [kept] = await db.select({ body: templates.body }).from(templates).where(where)
      expect(kept.body).toEqual(edited)
    } finally {
      await db.update(templates).set({ body: before.body }).where(where)
    }
  })
})
