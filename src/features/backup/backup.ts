import "server-only"
import { spawn } from "node:child_process"
import { randomBytes } from "node:crypto"

import { BlobWriter, configure, TextReader, Uint8ArrayReader, ZipWriter } from "@zip.js/zip.js"
import { and, desc, eq, sql } from "drizzle-orm"

import { db } from "@/db"
import { admins, backups, courses, ledgerTransactions } from "@/db/schema"
import { addPeriods, calendarFields, dayBefore, periodStart } from "@/lib/calendar"
import { env } from "@/lib/env"
import { UserError } from "@/lib/errors"
import { formatDate, formatMonthYear, localized, zonedParts } from "@/lib/format"
import { getSetting } from "@/lib/settings"
import { getStorage } from "@/lib/storage"
import { monthWorkbook } from "./excel"

/**
 * Backups (Settings → Backup). Each is a ZIP kept in the storage under
 * backup/<Istanbul day>/ with an unguessable name:
 *   - the whole database (`pg_dump --format=custom`, restored with pg_restore),
 *     by itself once a day and by hand at any time (several a day go in the same folder);
 *   - the financial report of each Solar Hijri month, made once that month is over.
 * Each file is listed in the `backups` table (Settings → Backup lists them).
 */

configure({ useWebWorkers: false })

export type BackupKind = (typeof backups.kind.enumValues)[number]

/** The whole database as a pg_dump archive (custom format, compressed). */
export function dumpDatabase(url: string = env.DATABASE_URL): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn("pg_dump", ["--format=custom", "--no-owner", "--no-privileges", "--dbname", url], {
      stdio: ["ignore", "pipe", "pipe"],
    })
    const out: Buffer[] = []
    const err: Buffer[] = []
    child.stdout.on("data", (b: Buffer) => out.push(b))
    child.stderr.on("data", (b: Buffer) => err.push(b))
    child.on("error", (e: NodeJS.ErrnoException) => reject(e.code === "ENOENT" ? new UserError("settings.backup.errors.noPgDump") : e))
    child.on("close", (code) => {
      // The message never includes the address: pg_dump does not print it.
      if (code === 0) resolve(Buffer.concat(out))
      else reject(new Error(`pg_dump exited with ${code}: ${Buffer.concat(err).toString("utf8").slice(0, 500)}`))
    })
  })
}

/** A ZIP of `entries`. */
export async function zipFiles(entries: { name: string; data: Buffer | string }[]): Promise<Buffer> {
  const zip = new ZipWriter(new BlobWriter("application/zip"))
  for (const e of entries) {
    await zip.add(e.name, typeof e.data === "string" ? new TextReader(e.data) : new Uint8ArrayReader(new Uint8Array(e.data)))
  }
  return Buffer.from(await (await zip.close()).arrayBuffer())
}

const RESTORE_README = `بازگردانی پشتیبان دیتابیس لیمر
================================

این فایل یک نسخهٔ کامل از دیتابیس سایت است (pg_dump، قالب custom).

برای بازگردانی روی یک دیتابیس خالی PostgreSQL (نسخهٔ ۱۸ یا بالاتر):

  pg_restore --no-owner --no-privileges --dbname "postgres://USER:PASSWORD@HOST:5432/DBNAME" limer.dump

بعد از بازگردانی، سایت را با همان ENCRYPTION_KEY قبلی اجرا کنید؛ بدون آن، اطلاعات رمزشده
(کد ملی مدرس‌ها، متن قراردادها، رمز ایمیل و CDN) خوانده نمی‌شوند.

Limer database backup — restore into an empty PostgreSQL 18+ database:
  pg_restore --no-owner --no-privileges --dbname "<connection url>" limer.dump
Run the site with the same ENCRYPTION_KEY, or encrypted fields cannot be read.
`

/** Where a backup goes: backup/<day>/<kind>-<HHMM>-<random>.zip (unguessable, so never linked publicly). */
function backupPath(day: string, time: string, kind: BackupKind) {
  const name = kind === "monthly" ? "month" : kind === "manual" ? "db-manual" : "db-daily"
  return `backup/${day}/${name}-${time.replace(":", "")}-${randomBytes(12).toString("base64url")}.zip`
}

/**
 * Make one backup now and keep it in the storage: the whole database (auto,
 * manual), or the report of the Solar Hijri month starting `month` (monthly).
 */
export async function createBackup(kind: BackupKind, by: string | null, month?: string) {
  const now = zonedParts(new Date())
  let entries: { name: string; data: Buffer | string }[]
  if (kind === "monthly") {
    if (!month) throw new Error("a monthly backup needs its month")
    const report = await monthWorkbook(month)
    entries = [{ name: `${monthFileName(month)}.xlsx`, data: report.file }]
  } else {
    const dump = await dumpDatabase()
    entries = [
      { name: `limer-${now.date}-${now.time.replace(":", "")}.dump`, data: dump },
      { name: "README.txt", data: RESTORE_README },
    ]
  }
  const file = await zipFiles(entries)
  const path = backupPath(now.date, now.time, kind)
  const storage = await getStorage()
  await storage.put(path, file, "application/zip")
  const [row] = await db
    .insert(backups)
    .values({ kind, path, size: file.length, day: now.date, month: kind === "monthly" ? month : null, createdBy: by })
    .returning({ id: backups.id })
  return { id: row.id, path, size: file.length }
}

/**
 * The scheduled part (pnpm jobs, every 15 minutes): when automatic backups are
 * on, the day's database backup (from 03:00 Istanbul
 * time) and, once a Solar Hijri month is over, its report.
 */
export async function runScheduledBackups(at: Date = new Date()) {
  const setting = await getSetting("backup")
  if (!setting.auto) return { made: 0, due: 0 }
  // One run at a time (the app's timer, `pnpm jobs`, and two containers side by side while deploying).
  return db.transaction(async (tx) => {
    const [{ locked }] = (await tx.execute<{ locked: boolean }>(sql`select pg_try_advisory_xact_lock(${BACKUP_LOCK}) as locked`)).rows
    return locked ? scheduled(at) : { made: 0, due: 0 }
  })
}

/** pg advisory lock key of the scheduled backups ("LMRB"). */
const BACKUP_LOCK = 0x4c4d5242

async function scheduled(at: Date) {
  const { date, time } = zonedParts(at)
  let due = 0
  let made = 0
  if (time >= "03:00") {
    const [today] = await db.select({ id: backups.id }).from(backups).where(and(eq(backups.kind, "auto"), eq(backups.day, date))).limit(1)
    if (!today) {
      due++
      await createBackup("auto", null)
      made++
    }
  }
  // The month that ended: the one before the month of today.
  const lastMonth = periodStart(dayBefore(periodStart(date, "month", "persian")), "month", "persian")
  const [report] = await db.select({ id: backups.id }).from(backups).where(and(eq(backups.kind, "monthly"), eq(backups.month, lastMonth))).limit(1)
  if (!report) {
    due++
    await createBackup("monthly", null, lastMonth)
    made++
  }
  return { made, due }
}

/** The backups kept, newest first (Settings → Backup), with who made each (empty: by itself). */
export async function listBackups(limit = 200) {
  return db
    .select({ id: backups.id, kind: backups.kind, day: backups.day, month: backups.month, size: backups.size, createdAt: backups.createdAt, by: admins.name })
    .from(backups)
    .leftJoin(admins, eq(admins.id, backups.createdBy))
    .orderBy(desc(backups.createdAt))
    .limit(limit)
}

/** "limer-report-1405-07": a Solar Hijri month's report, by its first day. */
export function monthFileName(first: string) {
  const { year, month } = calendarFields(first, "persian")
  return `limer-report-${year}-${String(month).padStart(2, "0")}`
}

/** One backup's file path and name to download it under, or null. */
export async function backupFile(id: string) {
  const [row] = await db.select({ path: backups.path, kind: backups.kind, day: backups.day, month: backups.month }).from(backups).where(eq(backups.id, id))
  if (!row) return null
  const name = row.kind === "monthly" && row.month ? `${monthFileName(row.month)}.zip` : `limer-db-${row.day}-${/-(\d{4})-[A-Za-z0-9_-]+\.zip$/.exec(row.path)?.[1] ?? "0000"}.zip`
  return { path: row.path, name }
}

/**
 * What the Excel downloads can be made for: every workshop (newest first) and
 * every Solar Hijri month from the first entry to this one (newest first;
 * the reports are Persian, so their months are named in Persian).
 */
export async function exportChoices(locale: string) {
  const [workshops, [first]] = await Promise.all([
    db.select({ id: courses.id, title: courses.title, startsAt: courses.startsAt }).from(courses).orderBy(desc(courses.startsAt)),
    db.select({ day: sql<string | null>`min(${ledgerTransactions.occurredOn})` }).from(ledgerTransactions),
  ])
  const today = zonedParts(new Date()).date
  const months: { value: string; label: string; current: boolean }[] = []
  const current = periodStart(today, "month", "persian")
  let m = periodStart(first?.day ?? today, "month", "persian")
  while (m <= current && months.length < 240) {
    months.push({ value: m, label: formatMonthYear(`${m}T09:00:00Z`, "fa"), current: m === current })
    m = addPeriods(m, 1, "month", "persian")
  }
  return {
    workshops: workshops.map((w) => ({ id: w.id, label: `${localized(w.title, locale)} · ${formatDate(w.startsAt, locale, "medium")}` })),
    months: months.reverse(),
  }
}
