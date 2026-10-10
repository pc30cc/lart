import "server-only"
import { configure, TextReader, ZipWriter } from "@zip.js/zip.js"

import { csvDate } from "@/features/money/csv"
import { errorForLog } from "@/lib/errors"
import { localized, zonedParts } from "@/lib/format"
import { getStorage } from "@/lib/storage"
import { invoiceFiles } from "./data"

configure({ useWebWorkers: false })

/** "1405-07-18": a day in the Solar Hijri calendar, for file and folder names (sorts by name). */
const shamsi = (day: string) => csvDate(day, "fa").replaceAll("/", "-")

/** A file or folder name any system accepts: no path or reserved characters, not too long. */
export function safeName(text: string, max = 80): string {
  const clean = text
    .replace(/[\u0000-\u001f\u007f/\\:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[.\s]+|[.\s]+$/g, "")
  return Array.from(clean).slice(0, max).join("").trim() || "-"
}

export const INVOICE_FOLDERS = { workshops: "ورکشاپ‌ها", general: "هزینه‌های عمومی", furnishing: "اثاثیه" } as const

/**
 * Where each kept file goes in the invoices ZIP:
 *   ورکشاپ‌ها/<start day> - <workshop>/<day> - <expense> - فیش.webp
 *   هزینه‌های عمومی/<day> - <expense> - فیش.pdf
 *   اثاثیه/<day> - <expense> - عکس.webp
 * Two files of the same name get " (2)", " (3)", ...
 */
export function invoiceEntries(files: Awaited<ReturnType<typeof invoiceFiles>>): { name: string; path: string }[] {
  const used = new Set<string>()
  return files.map((f) => {
    const folder = f.furnishing
      ? INVOICE_FOLDERS.furnishing
      : f.courseId
        ? `${INVOICE_FOLDERS.workshops}/${safeName(`${f.courseStart ? shamsi(zonedParts(f.courseStart).date) : ""} - ${localized(f.courseTitle ?? {}, "fa") || f.courseSlug || ""}`)}`
        : INVOICE_FOLDERS.general
    const ext = f.path.split(".").at(-1)?.toLowerCase() ?? "bin"
    const base = safeName(`${shamsi(f.occurredOn)} - ${f.description} - ${f.role === "photo" ? "عکس" : "فیش"}`)
    let name = `${folder}/${base}.${ext}`
    for (let n = 2; used.has(name); n++) name = `${folder}/${base} (${n}).${ext}`
    used.add(name)
    return { name, path: f.path }
  })
}

/**
 * Every file kept with an expense as one ZIP, streamed as it is made (the
 * files are read from the storage one by one, so a large archive never sits in
 * memory). Pictures and PDFs are already compressed: stored as they are. A
 * file the storage cannot give is listed in «فایل‌های ناموجود.txt».
 */
export async function invoicesZip(): Promise<ReadableStream<Uint8Array>> {
  const [entries, storage] = await Promise.all([invoiceFiles().then(invoiceEntries), getStorage()])
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>()
  const zip = new ZipWriter(writable, { level: 0, keepOrder: true })
  void (async () => {
    const missing: string[] = []
    for (const e of entries) {
      try {
        const file = await storage.read(e.path)
        if (!file) missing.push(e.name)
        else await zip.add(e.name, file.body)
      } catch (err) {
        console.error("[invoices] could not add a file", errorForLog(err))
        missing.push(e.name)
      }
    }
    if (entries.length === 0) await zip.add("خالی.txt", new TextReader("هنوز فایلی کنار هزینه‌ها ثبت نشده است.\n"))
    if (missing.length) await zip.add("فایل‌های ناموجود.txt", new TextReader(`${missing.join("\n")}\n`))
    await zip.close()
  })().catch((err) => console.error("[invoices] the ZIP failed", errorForLog(err)))
  return readable
}
