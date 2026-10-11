/**
 * One workshop open for registration, for trying the student's sign-up and
 * payment on the live site, and removing it all afterwards.
 *
 *   pnpm tsx scripts/test-workshop.ts add <manifest.json> [--production]
 *   pnpm tsx scripts/test-workshop.ts remove <manifest.json> [--production]
 *
 * `add` creates a published workshop two weeks ahead (its own instructor, at
 * an address that cannot receive mail, with a signed contract; an existing
 * category). `remove` deletes the workshop with everything recorded on it
 * while testing: registrations, payments and refunds in the books (through the
 * factory-reset switch of drizzle/0013), its contract and its instructor.
 * Student accounts made while testing are people's own and stay.
 */
import "dotenv/config"

import Module, { createRequire } from "node:module"
import { existsSync, readFileSync, writeFileSync } from "node:fs"

const load = createRequire(__filename)
const marker = load.resolve("server-only")
load.cache[marker] = Object.assign(new Module(marker), { filename: marker, loaded: true, exports: {} })

type Manifest = { createdAt: string; course: string; instructor: string; category: string | null }

const DAY = 86_400_000
const DOMAIN = "test.limer.invalid"

/** Istanbul time (UTC+3) on a day relative to today. */
function at(days: number, hour: number): Date {
  const d = new Date(Date.now() + days * DAY)
  d.setUTCHours(hour - 3, 0, 0, 0)
  return d
}

async function add(manifestPath: string) {
  if (existsSync(manifestPath)) throw new Error(`${manifestPath} exists: the test workshop is already there (remove it first)`)
  const { db } = await import("../src/db")
  const { and, asc, eq } = await import("drizzle-orm")
  const S = await import("../src/db/schema")
  const { encrypt } = await import("../src/lib/crypto")
  const { activePartners } = await import("../src/features/money/closing")

  const [partner] = (await activePartners(db)).filter((p) => p.shareBp > 0)
  if (!partner) throw new Error("no active partner")
  const [template] = await db.select({ id: S.templates.id }).from(S.templates).where(and(eq(S.templates.kind, "contract"), eq(S.templates.isDefault, true)))
  if (!template) throw new Error("no default contract template")

  const m: Manifest = { createdAt: new Date().toISOString(), course: "", instructor: "", category: null }
  const save = () => writeFileSync(manifestPath, JSON.stringify(m, null, 2))
  await db.transaction(async (tx) => {
    let [category] = await tx.select({ id: S.categories.id }).from(S.categories).orderBy(asc(S.categories.sort)).limit(1)
    if (!category) {
      ;[category] = await tx.insert(S.categories).values({ slug: "test", name: { fa: "آزمایشی", tr: "Deneme", en: "Test" } }).returning({ id: S.categories.id })
      m.category = category.id
    }
    const [instructor] = await tx
      .insert(S.instructors)
      .values({
        email: `instructor@${DOMAIN}`,
        officialName: "Test Eğitmen",
        idNumberEnc: encrypt("10000000146"),
        mobile: "+90 530 000 00 00",
        displayName: { fa: "مدرس آزمایشی", tr: "Test Eğitmen", en: "Test Instructor" },
        teachingField: { fa: "آزمایشی", tr: "Deneme", en: "Test" },
        teachingLanguages: ["fa", "tr", "en"],
        approvedAt: new Date(),
        emailVerifiedAt: new Date(),
      })
      .returning({ id: S.instructors.id })
    m.instructor = instructor.id

    const startsAt = at(14, 14)
    const [course] = await tx
      .insert(S.courses)
      .values({
        slug: `test-kayit-${Date.now().toString(36)}`,
        status: "published",
        categoryId: category.id,
        instructorId: instructor.id,
        title: { fa: "ورکشاپ آزمایشی (تست ثبت‌نام)", tr: "Deneme Atölyesi (kayıt testi)", en: "Test Workshop (registration test)" },
        intro: {
          fa: "این ورکشاپ فقط برای آزمایش ثبت‌نام است و برگزار نمی‌شود.",
          tr: "Bu atölye yalnızca kayıt testi içindir; yapılmayacak.",
          en: "This workshop is only for testing registration; it will not take place.",
        },
        includes: { fa: "—", tr: "—", en: "—" },
        bring: { fa: "—", tr: "—", en: "—" },
        venue: { fa: "استودیو لیمر", tr: "Limer Atölye", en: "Limer Studio" },
        startsAt,
        endsAt: at(14, 17),
        minCapacity: 1,
        maxCapacity: 10,
        price: 10_000,
        registrationDeadline: new Date(startsAt.getTime() - DAY),
        decisionAt: new Date(startsAt.getTime() - 3 * DAY),
        // The decision job has nothing to tell the partners about it.
        decisionNotifiedAt: new Date(),
        publishedAt: new Date(),
        createdBy: partner.adminId,
      })
      .returning({ id: S.courses.id })
    m.course = course.id

    await tx.insert(S.contracts).values({
      courseId: course.id,
      instructorId: instructor.id,
      status: "signed",
      templateId: template.id,
      feeType: "fixed",
      feeAmount: 0,
      advanceAmount: 0,
      sentAt: new Date(),
      signedAt: new Date(),
      signedName: "Test Eğitmen",
      signedLocale: "tr",
    })
  })
  save()
  console.info(`[test-workshop] added: workshop ${m.course}`)
}

async function remove(manifestPath: string) {
  const m: Manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
  const { db } = await import("../src/db")
  const { eq, inArray, sql } = await import("drizzle-orm")
  const S = await import("../src/db/schema")

  // Only the test's own instructor: a wrong or edited manifest must never delete a real one.
  const [instructor] = await db.select({ email: S.instructors.email }).from(S.instructors).where(eq(S.instructors.id, m.instructor))
  if (instructor && !instructor.email?.endsWith(`@${DOMAIN}`)) throw new Error(`the manifest names ${instructor.email}, who is not test data: nothing removed`)

  const counts = await db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('lart.factory_reset', 'on', true)`)
    const ledger = await tx.select({ id: S.ledgerTransactions.id }).from(S.ledgerTransactions).where(eq(S.ledgerTransactions.courseId, m.course))
    const ids = ledger.map((r) => r.id)
    if (ids.length) {
      await tx.delete(S.expenseFiles).where(inArray(S.expenseFiles.transactionId, ids))
      await tx.delete(S.ledgerLines).where(inArray(S.ledgerLines.transactionId, ids))
      await tx.delete(S.ledgerTransactions).where(inArray(S.ledgerTransactions.id, ids))
    }
    const regs = await tx.delete(S.registrations).where(eq(S.registrations.courseId, m.course)).returning({ id: S.registrations.id })
    await tx.delete(S.media).where(eq(S.media.courseId, m.course))
    await tx.delete(S.contracts).where(eq(S.contracts.courseId, m.course))
    await tx.delete(S.courses).where(eq(S.courses.id, m.course))
    await tx.delete(S.instructors).where(eq(S.instructors.id, m.instructor))
    if (m.category) await tx.delete(S.categories).where(eq(S.categories.id, m.category))
    await tx.execute(sql`select set_config('lart.factory_reset', 'off', true)`)
    return { registrations: regs.length, transactions: ids.length }
  })
  console.info(`[test-workshop] removed: the workshop, ${counts.registrations} registration(s), ${counts.transactions} transaction(s)`)
}

const args = process.argv.slice(2)
const production = args.includes("--production")
const [mode, file] = args.filter((arg) => arg !== "--production")
const local = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(process.env.APP_URL ?? "")
const run = !local && !production
  ? Promise.reject(new Error(`APP_URL is ${process.env.APP_URL ?? "not set"}, not this computer: add --production if this is meant for the live site`))
  : mode === "add" && file ? add(file) : mode === "remove" && file ? remove(file) : Promise.reject(new Error("usage: add <manifest> | remove <manifest>"))
run.then(
  () => process.exit(0),
  (err) => {
    console.error("[test-workshop] failed:", err)
    process.exit(1)
  },
)
