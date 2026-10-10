import { BlobWriter, TextWriter, Uint8ArrayReader, ZipReader, type FileEntry } from "@zip.js/zip.js"
import ExcelJS from "exceljs"
import { eq, inArray } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import { db } from "@/db"
import { backups } from "@/db/schema"
import { encrypt } from "@/lib/crypto"

const files = vi.hoisted(() => new Map<string, Buffer>())
const backupSetting = vi.hoisted(() => ({ value: { passwordEnc: "", auto: true } }))

vi.mock("@/lib/storage", async (load) => ({
  ...(await load<typeof import("@/lib/storage")>()),
  getStorage: async () => ({
    put: async (path: string, body: Uint8Array) => void files.set(path, Buffer.from(body)),
    read: async (path: string) => {
      const b = files.get(path)
      return b ? { body: new Blob([new Uint8Array(b)]).stream(), size: b.length, contentType: null } : null
    },
    remove: async (path: string) => void files.delete(path),
    publicUrl: (path: string) => `https://cdn.test/${path}`,
  }),
}))
vi.mock("@/lib/settings", async (load) => {
  const real = await load<typeof import("@/lib/settings")>()
  return { ...real, getSetting: async (key: string) => (key === "backup" ? backupSetting.value : real.getSetting(key as never)) }
})

const { createBackup, lockedZip, runScheduledBackups, backupFile, monthFileName } = await import("./backup")
const { expensesWorkbook, financeWorkbook, monthWorkbook } = await import("./excel")
const { invoiceEntries, safeName } = await import("./invoices")

const made: string[] = []
const PASSWORD = "a-long-test-password"

async function entries(zip: Buffer, password?: string) {
  const reader = new ZipReader(new Uint8ArrayReader(new Uint8Array(zip)), { password })
  const list = (await reader.getEntries()).filter((e): e is FileEntry => !e.directory)
  return { list, reader }
}

beforeAll(() => {
  backupSetting.value = { passwordEnc: encrypt(PASSWORD), auto: true }
})

afterAll(async () => {
  if (made.length) await db.delete(backups).where(inArray(backups.id, made))
})

describe("lockedZip", () => {
  it("opens with the password only", async () => {
    const zip = await lockedZip([{ name: "a.txt", data: "سلام" }], PASSWORD)
    const { list } = await entries(zip, PASSWORD)
    expect(list[0].encrypted).toBe(true)
    expect(await list[0].getData(new TextWriter())).toBe("سلام")
    const wrong = await entries(zip, "not-the-password")
    await expect(wrong.list[0].getData(new TextWriter())).rejects.toThrow()
  })
})

describe("createBackup", () => {
  it("refuses without a password", async () => {
    backupSetting.value = { passwordEnc: "", auto: true }
    await expect(createBackup("manual", null)).rejects.toThrow("settings.backup.errors.noPassword")
    backupSetting.value = { passwordEnc: encrypt(PASSWORD), auto: true }
  })

  it("keeps a locked dump of the whole database in backup/<day>/, several a day side by side", async () => {
    const a = await createBackup("manual", null)
    const b = await createBackup("manual", null)
    made.push(a.id, b.id)
    expect(a.path).toMatch(/^backup\/\d{4}-\d{2}-\d{2}\/db-manual-\d{4}-[A-Za-z0-9_-]{16}\.zip$/)
    expect(a.path.split("/")[1]).toBe(b.path.split("/")[1])
    expect(a.path).not.toBe(b.path)

    const { list } = await entries(files.get(a.path)!, PASSWORD)
    expect(list.map((e) => e.filename).sort()).toEqual(expect.arrayContaining(["README.txt"]))
    const dump = list.find((e) => e.filename.endsWith(".dump"))!
    const blob = await dump.getData(new BlobWriter())
    // pg_dump's custom format starts with "PGDMP".
    expect(new TextDecoder().decode(new Uint8Array(await blob.slice(0, 5).arrayBuffer()))).toBe("PGDMP")

    const [row] = await db.select().from(backups).where(eq(backups.id, a.id))
    expect(row).toMatchObject({ kind: "manual", path: a.path, size: files.get(a.path)!.length })
    expect((await backupFile(a.id))?.name).toMatch(/^limer-db-\d{4}-\d{2}-\d{2}-\d{4}\.zip$/)
  })
})

describe("runScheduledBackups", () => {
  it("makes the day's backup and last month's report once, and nothing when switched off", async () => {
    const at = new Date()
    const first = await runScheduledBackups(at)
    const again = await runScheduledBackups(at)
    const rows = await db.select({ id: backups.id }).from(backups)
    made.push(...rows.map((r) => r.id))
    expect(again).toEqual({ made: 0, due: 0 })
    expect(first.made).toBe(first.due)

    backupSetting.value = { passwordEnc: encrypt(PASSWORD), auto: false }
    expect(await runScheduledBackups(at)).toEqual({ made: 0, due: 0 })
    backupSetting.value = { passwordEnc: encrypt(PASSWORD), auto: true }
  })
})

describe("Excel reports", () => {
  async function sheets(file: Buffer) {
    const book = new ExcelJS.Workbook()
    await book.xlsx.load(file as unknown as ArrayBuffer)
    return book
  }

  it("are right-to-left Persian workbooks", async () => {
    for (const file of [await expensesWorkbook(), await financeWorkbook(), (await monthWorkbook("2026-09-23")).file]) {
      const book = await sheets(file)
      expect(book.worksheets.length).toBeGreaterThan(0)
      for (const ws of book.worksheets) expect(ws.views[0]?.rightToLeft).toBe(true)
    }
  })

  it("names a month's report by its Solar Hijri month", async () => {
    expect(monthFileName("2026-09-23")).toBe("limer-report-1405-07")
    expect((await monthWorkbook("2026-09-23")).name).toBe("مهر ۱۴۰۵")
  })
})

describe("invoices ZIP", () => {
  it("puts each file in its folder with a readable, unique name", () => {
    const base = { role: "receipt" as const, occurredOn: "2026-10-01", furnishing: false, courseId: null, courseTitle: null, courseSlug: null, courseStart: null }
    const names = invoiceEntries([
      { ...base, path: "receipts/a.webp", description: "رنگ / قلم‌مو" },
      { ...base, path: "receipts/b.webp", description: "رنگ / قلم‌مو" },
      { ...base, path: "receipts/c.pdf", description: "میز", furnishing: true, role: "photo" },
      { ...base, path: "receipts/d.webp", description: "گل", courseId: "x", courseTitle: { fa: "گلدان سفالی" }, courseSlug: "pot", courseStart: new Date("2026-10-05T10:00:00Z") },
    ]).map((e) => e.name)
    expect(names).toEqual([
      "هزینه‌های عمومی/1405-07-09 - رنگ قلم‌مو - فیش.webp",
      "هزینه‌های عمومی/1405-07-09 - رنگ قلم‌مو - فیش (2).webp",
      "اثاثیه/1405-07-09 - میز - عکس.pdf",
      "ورکشاپ‌ها/1405-07-13 - گلدان سفالی/1405-07-09 - گل - فیش.webp",
    ])
    expect(safeName('../..\\a:b*?"<>|')).toBe("a b")
  })
})
